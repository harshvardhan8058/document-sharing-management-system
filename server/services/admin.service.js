"use strict";

/**
 * Instance administration.
 *
 * The user schema always carried `role` and `isActive`, but nothing could change
 * them — an admin could see that an account existed and do nothing about it.
 */

const { db } = require("../data");
const config = require("../config/env");
const ApiError = require("../utils/ApiError");
const { readPagination, buildMeta } = require("../utils/pagination");
const { formatBytes } = require("../utils/files");

const authService = require("./auth.service");
const documentService = require("./document.service");
const activityService = require("./activity.service");
const storage = require("./storage.service");

const ROLES = ["admin", "member"];

/** Paginated account list with each user's real footprint. */
async function listUsers({ query = {} } = {}) {
  const { page, limit, skip } = readPagination(query);

  const filter = {};
  if (query.search) {
    const term = String(query.search).trim();
    if (term) {
      filter.$or = [
        { email: { $regex: term, $options: "i" } },
        { firstName: { $regex: term, $options: "i" } },
        { lastName: { $regex: term, $options: "i" } },
      ];
    }
  }
  if (query.role && ROLES.includes(query.role)) filter.role = query.role;

  const [records, total] = await Promise.all([
    db.users.find(filter, { sort: { createdAt: -1 }, skip, limit }),
    db.users.count(filter),
  ]);

  const users = await Promise.all(
    records.map(async (record) => {
      const [documents, trashed, usedBytes] = await Promise.all([
        db.documents.count({ ownerId: record.id, status: "active" }),
        db.documents.count({ ownerId: record.id, status: "trashed" }),
        documentService.usageBytesFor(record.id),
      ]);

      const quotaBytes = Number(record.storageQuotaBytes) || config.storage.quotaBytes;

      return {
        ...authService.publicUser(record),
        documents,
        trashed,
        usedBytes,
        usedLabel: formatBytes(usedBytes),
        quotaBytes,
        quotaLabel: formatBytes(quotaBytes),
        usedPercent: quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10) : 0,
      };
    })
  );

  return { users, meta: buildMeta({ page, limit, total }) };
}

/**
 * Change an account's role, active state or quota.
 *
 * The guards matter more than the update: an instance that can be left with no
 * admin, or an admin who locks themselves out, is unrecoverable without database
 * surgery.
 */
async function updateUser({ actor, userId, body = {}, req }) {
  const target = await db.users.findById(userId);
  if (!target) throw ApiError.notFound("User not found", { code: "USER_NOT_FOUND" });

  const patch = {};
  const changes = [];

  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) {
      throw ApiError.unprocessable(`Role must be one of: ${ROLES.join(", ")}`, {
        details: [{ field: "role", message: "Invalid value" }],
      });
    }
    if (body.role !== target.role) {
      patch.role = body.role;
      changes.push(`role ${target.role} -> ${body.role}`);
    }
  }

  if (body.isActive !== undefined) {
    const isActive = Boolean(body.isActive);

    // Locking yourself out is never the intent, and nobody else can undo it.
    if (target.id === actor.id && !isActive) {
      throw ApiError.badRequest("You cannot deactivate your own account", { code: "SELF_DEACTIVATE" });
    }

    if (isActive !== (target.isActive !== false)) {
      patch.isActive = isActive;
      changes.push(isActive ? "reactivated" : "deactivated");

      // Deactivating has to kill live sessions, otherwise an unexpired token
      // keeps working until it lapses.
      if (!isActive) patch.tokenVersion = (Number(target.tokenVersion) || 0) + 1;
    }
  }

  /**
   * One invariant instead of two guards: the instance must still have an active
   * admin afterwards.
   *
   * The first version checked "is the target the last admin?" separately for role
   * and for activation, and both branches were unreachable — a caller is
   * necessarily an active admin, so any *other* admin implies at least two. It
   * also mis-fired on an already-deactivated admin, refusing a demotion that was
   * perfectly safe. Comparing the before and after state covers the case that
   * actually matters: a sole admin demoting themselves.
   */
  const wasActiveAdmin = target.role === "admin" && target.isActive !== false;
  const willBeActiveAdmin =
    (patch.role ?? target.role) === "admin" && (patch.isActive ?? target.isActive !== false) !== false;

  if (wasActiveAdmin && !willBeActiveAdmin) {
    const activeAdmins = await db.users.count({ role: "admin", isActive: { $ne: false } });
    if (activeAdmins <= 1) {
      throw ApiError.badRequest(
        "This is the only active admin — promote someone else before removing these rights.",
        { code: "LAST_ADMIN" }
      );
    }
  }

  if (body.storageQuotaGb !== undefined) {
    const gb = Number(body.storageQuotaGb);
    if (!Number.isFinite(gb) || gb < 0 || gb > 10_000) {
      throw ApiError.unprocessable("storageQuotaGb must be between 0 and 10000", {
        details: [{ field: "storageQuotaGb", message: "Out of range" }],
      });
    }
    const bytes = Math.round(gb * 1024 * 1024 * 1024);
    if (bytes !== Number(target.storageQuotaBytes)) {
      patch.storageQuotaBytes = bytes;
      changes.push(`quota -> ${formatBytes(bytes)}`);
    }
  }

  if (!Object.keys(patch).length) throw ApiError.badRequest("Nothing to update");

  const updated = await db.users.updateById(userId, patch);

  await activityService.record("admin.user_updated", {
    req,
    actor,
    detail: `${target.email}: ${changes.join(", ")}`,
  });

  return { user: authService.publicUser(updated), changes };
}

/**
 * Reconcile the database against the upload directory.
 *
 * The first version of this guessed — `diskFiles - documentCount` — which
 * counted every historical version as an orphan and reported a scary number on a
 * perfectly healthy instance. This compares the actual filename sets, and reports
 * the opposite failure (a record whose file is gone) too, which the guess could
 * not detect at all.
 */
async function reconcileStorage() {
  const [documents, onDisk] = await Promise.all([
    db.documents.find({}),
    storage.listStoredFiles(),
  ]);

  const referenced = new Set();
  for (const document of documents) {
    if (document.storedName) referenced.add(document.storedName);
    for (const version of document.versions || []) {
      if (version.storedName) referenced.add(version.storedName);
    }
  }

  const diskSet = new Set(onDisk);
  const orphaned = onDisk.filter((name) => !referenced.has(name));
  const missing = [...referenced].filter((name) => !diskSet.has(name));

  let orphanedBytes = 0;
  for (const name of orphaned) {
    const stats = await storage.statOf(name);
    if (stats) orphanedBytes += stats.size;
  }

  return {
    referencedFiles: referenced.size,
    filesOnDisk: onDisk.length,
    orphanedFiles: orphaned.length,
    orphanedBytes,
    orphanedLabel: formatBytes(orphanedBytes),
    /** Records whose file has vanished — downloads for these will 404. */
    missingFiles: missing.length,
    sample: {
      orphaned: orphaned.slice(0, 10),
      missing: missing.slice(0, 10),
    },
  };
}

/** Delete unreferenced files. Explicit action, never automatic. */
async function purgeOrphanedFiles({ actor, req }) {
  const { sample, ...summary } = await reconcileStorage();

  const [documents, onDisk] = await Promise.all([db.documents.find({}), storage.listStoredFiles()]);
  const referenced = new Set();
  for (const document of documents) {
    if (document.storedName) referenced.add(document.storedName);
    for (const version of document.versions || []) referenced.add(version.storedName);
  }

  const orphaned = onDisk.filter((name) => !referenced.has(name));
  const removed = await storage.removeFiles(orphaned);

  await activityService.record("admin.user_updated", {
    req,
    actor,
    detail: `Purged ${removed} unreferenced file(s) (${summary.orphanedLabel})`,
  });

  return { removed, bytes: summary.orphanedBytes, label: summary.orphanedLabel };
}

module.exports = { listUsers, updateUser, reconcileStorage, purgeOrphanedFiles, ROLES };
