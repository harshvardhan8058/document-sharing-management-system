"use strict";

const { db } = require("../data");
const config = require("../config/env");
const ApiError = require("../utils/ApiError");
const { readPagination, buildMeta, readSort } = require("../utils/pagination");
const {
  categoryOf,
  extensionOf,
  mimeTypeOf,
  sanitizeFilename,
  formatBytes,
  isInlinePreviewable,
} = require("../utils/files");

const storage = require("./storage.service");
const access = require("./access.service");
const activity = require("./activity.service");

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;
const VISIBILITIES = ["private", "internal", "public"];

/**
 * Bytes an owner actually occupies on disk.
 *
 * Sums every stored version, not just the current one, and counts trashed
 * documents — both still consume disk until they are permanently deleted. A
 * quota that ignored them would let someone exceed their allowance simply by
 * uploading revisions or by never emptying their trash.
 */
async function usageBytesFor(ownerId) {
  const documents = await db.documents.find({ ownerId });

  return documents.reduce((total, doc) => {
    const versions = doc.versions || [];
    if (!versions.length) return total + (Number(doc.size) || 0);
    return total + versions.reduce((sum, version) => sum + (Number(version.size) || 0), 0);
  }, 0);
}

/** Resolve an owner's allowance, falling back to the deployment default. */
async function quotaBytesFor(userId) {
  const record = await db.users.findById(userId);
  const configured = Number(record?.storageQuotaBytes);
  return Number.isFinite(configured) && configured > 0 ? configured : config.storage.quotaBytes;
}

/**
 * Refuse an upload that would push the owner past their allowance.
 *
 * The quota was previously displayed throughout the UI but never checked, so it
 * was decoration. A quota of 0 disables the limit.
 */
async function assertWithinQuota({ userId, incomingBytes }) {
  const quota = await quotaBytesFor(userId);
  if (quota <= 0) return;

  const used = await usageBytesFor(userId);
  if (used + incomingBytes <= quota) return;

  throw new ApiError(
    413,
    `This upload would exceed your ${formatBytes(quota)} storage allowance ` +
      `(${formatBytes(used)} already in use). Delete something first, or empty your trash.`,
    {
      code: "STORAGE_QUOTA_EXCEEDED",
      details: [
        {
          usedBytes: used,
          quotaBytes: quota,
          incomingBytes,
          remainingBytes: Math.max(0, quota - used),
        },
      ],
    }
  );
}

/** Escape user input before it is used inside a RegExp. */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Normalise a tag list: trimmed, lowercased, de-duplicated, length-capped. */
function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const tags = [];
  for (const item of raw) {
    const tag = String(item).trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/**
 * Shape a stored document for the API, folding in what *this* caller may do.
 * The client renders its affordances straight from these booleans, so the UI
 * and the server can never disagree about permissions.
 */
function present(document, { user = null, accessLevel = "view" } = {}) {
  const isOwner = Boolean(user && document.ownerId === user.id);

  return {
    id: document.id,
    title: document.title,
    description: document.description || "",
    tags: document.tags || [],

    ownerId: document.ownerId,
    ownerName: document.ownerName || "",
    isOwner,

    visibility: document.visibility,
    status: document.status,
    trashedAt: document.trashedAt || null,

    file: {
      originalName: document.originalName,
      mimeType: document.mimeType,
      extension: document.extension,
      size: document.size,
      sizeLabel: formatBytes(document.size),
      checksum: document.checksum || "",
      category: document.category,
      previewable: isInlinePreviewable(document.mimeType),
    },

    collectionId: document.collectionId || null,
    searchable: Boolean(document.contentSnippet),

    version: document.version,
    versionCount: (document.versions || []).length,

    downloadCount: document.downloadCount || 0,
    viewCount: document.viewCount || 0,
    isStarred: Boolean(user && (document.starredBy || []).includes(user.id)),

    accessLevel,
    permissions: {
      canView: true,
      canEdit: access.satisfies(accessLevel, "edit"),
      canManage: access.satisfies(accessLevel, "manage"),
      canDelete: access.satisfies(accessLevel, "owner") || accessLevel === "manage",
    },

    links: {
      self: `/api/documents/${document.id}`,
      download: `/api/documents/${document.id}/download`,
      preview: `/api/documents/${document.id}/preview`,
    },

    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

/**
 * The set of active documents this user is allowed to see, as a filter clause.
 *
 * Every scope that is not already restricted to the caller's own documents has
 * to be intersected with this. `scope=starred` originally was not, which meant a
 * star kept a document visible in the listing after its owner revoked access —
 * leaking title, filename, owner and size (the file itself stayed protected).
 * Keeping the rule in one function is what stops that from recurring.
 */
async function accessibleClause(user) {
  if (user.role === "admin") return { status: "active" };

  const sharedIds = await access.documentIdsSharedWith(user);
  return {
    status: "active",
    $or: [
      { ownerId: user.id },
      ...(sharedIds.length ? [{ id: { $in: sharedIds } }] : []),
      { visibility: { $in: ["internal", "public"] } },
    ],
  };
}

/**
 * A window of stored text around the first occurrence of `term`.
 *
 * Returned with search results so the UI can show *why* a document matched.
 * Without this, a content hit looks identical to a title hit and the user has to
 * open the file to find out what the match even was.
 *
 * @returns {{text: string, term: string}|null}
 */
function buildExcerpt(snippet, term, radius = 90) {
  if (!snippet || !term) return null;

  const needle = String(term).trim().toLowerCase();
  const at = snippet.indexOf(needle);
  if (at === -1) return null;

  const start = Math.max(0, at - radius);
  const end = Math.min(snippet.length, at + needle.length + radius);

  // Ellipses only where text was actually cut.
  const text = `${start > 0 ? "…" : ""}${snippet.slice(start, end).trim()}${end < snippet.length ? "…" : ""}`;

  return { text, term: needle };
}

/** Build the driver-agnostic filter for a listing request. */
async function buildListFilter({ user, query }) {
  const scope = String(query.scope || "all");
  const clauses = [];

  if (scope === "mine") {
    clauses.push({ ownerId: user.id, status: "active" });
  } else if (scope === "trash") {
    clauses.push({ ownerId: user.id, status: "trashed" });
  } else if (scope === "shared") {
    const ids = await access.documentIdsSharedWith(user);
    if (!ids.length) return null; // nothing shared — short-circuit
    clauses.push({ id: { $in: ids }, status: "active" });
  } else if (scope === "starred") {
    // Starring is a bookmark, never a grant: the accessibility clause still applies.
    clauses.push({ starredBy: user.id });
    clauses.push(await accessibleClause(user));
  } else {
    clauses.push(await accessibleClause(user));
  }

  if (query.search) {
    const pattern = escapeRegex(String(query.search).trim());
    if (pattern) {
      const fields = [
        { title: { $regex: pattern, $options: "i" } },
        { description: { $regex: pattern, $options: "i" } },
        { originalName: { $regex: pattern, $options: "i" } },
        { tags: { $regex: pattern, $options: "i" } },
      ];

      // Opt-in, because searching inside documents is slower and because a hit
      // on body text is a different kind of result than a hit on a title.
      if (query.inContent === "true" || query.inContent === true) {
        fields.push({ contentSnippet: { $regex: pattern, $options: "i" } });
      }

      clauses.push({ $or: fields });
    }
  }

  if (query.category) clauses.push({ category: String(query.category) });

  // "unfiled" is a real filter, not the absence of one.
  if (query.collectionId === "none") clauses.push({ collectionId: null });
  else if (query.collectionId) clauses.push({ collectionId: String(query.collectionId) });
  if (query.tag) clauses.push({ tags: String(query.tag).toLowerCase() });
  if (query.visibility && VISIBILITIES.includes(query.visibility)) {
    clauses.push({ visibility: query.visibility });
  }
  if (query.ownerId) clauses.push({ ownerId: String(query.ownerId) });

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

/** Paginated, filtered listing. */
async function list({ user, query = {} }) {
  const { page, limit, skip } = readPagination(query);
  const filter = await buildListFilter({ user, query });

  if (filter === null) {
    return { documents: [], meta: buildMeta({ page, limit, total: 0 }), facets: { categories: {}, tags: [] } };
  }

  const sort = readSort(query.sort);
  const [records, total, categories, tags] = await Promise.all([
    db.documents.find(filter, { sort, skip, limit }),
    db.documents.count(filter),
    db.documents.groupCount("category", filter),
    db.documents.distinct("tags", filter),
  ]);

  // Resolve each row's access level so the client gets accurate affordances.
  const term = query.search ? String(query.search).trim() : "";
  const wantExcerpt = Boolean(term) && (query.inContent === "true" || query.inContent === true);

  const documents = await Promise.all(
    records.map(async (record) => {
      const resolved = await access.resolve(record, user);
      const shaped = present(record, { user, accessLevel: resolved.level });

      if (wantExcerpt) {
        const excerpt = buildExcerpt(record.contentSnippet, term);
        if (excerpt) shaped.matchExcerpt = excerpt;
      }

      return shaped;
    })
  );

  return {
    documents,
    meta: buildMeta({ page, limit, total }),
    facets: { categories, tags: tags.sort() },
  };
}

/** Fetch one document, counting the view. */
async function getOne({ id, user, req, countView = true }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, "view");

  let current = document;
  if (countView) {
    current = (await db.documents.increment(id, { viewCount: 1 })) || document;
  }

  const [shares, timeline] = await Promise.all([
    access.satisfies(resolved.level, "manage")
      ? db.shares.find({ documentId: id, revokedAt: null }, { sort: { createdAt: -1 } })
      : Promise.resolve([]),
    activity.listForDocument(id, 25),
  ]);

  return {
    document: present(current, { user, accessLevel: resolved.level }),
    versions: (current.versions || []).slice().reverse(),
    shares: shares.map((share) => ({
      id: share.id,
      type: share.type,
      email: share.email,
      userId: share.userId,
      permission: share.permission,
      expiresAt: share.expiresAt,
      hasPassword: Boolean(share.passwordHash),
      maxDownloads: share.maxDownloads,
      downloadCount: share.downloadCount,
      token: share.type === "link" ? share.token : undefined,
      createdAt: share.createdAt,
    })),
    activity: timeline,
  };
}

/** Create a document from an uploaded file. */
async function create({ user, file, body = {}, req }) {
  if (!file) throw ApiError.badRequest("A file is required", { code: "FILE_REQUIRED" });

  await storage.assertContentMatchesExtension(file);
  await assertWithinQuota({ userId: user.id, incomingBytes: file.size });

  const originalName = sanitizeFilename(file.originalname);
  const extension = extensionOf(originalName);
  const now = new Date().toISOString();

  // Trust our own extension mapping over the client-declared Content-Type.
  const mimeType = mimeTypeOf(originalName, file.mimetype || "application/octet-stream");
  const checksum = await storage.checksumOf(file.path).catch(() => "");

  const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : "private";
  const title = String(body.title || "").trim() || originalName;

  const indexed = await storage.extractSearchSnippet({
    absolutePath: file.path,
    mimeType,
    extension,
  });

  // Filing at upload time, if the client dragged into a collection.
  let collectionId = null;
  if (body.collectionId) {
    const owned = await db.collections.findById(String(body.collectionId));
    if (owned && owned.ownerId === user.id) collectionId = owned.id;
  }

  const created = await db.documents.create({
    title,
    description: String(body.description || "").trim(),
    tags: normalizeTags(body.tags),

    ownerId: user.id,
    ownerName: user.fullName,
    visibility,

    storedName: file.filename,
    originalName,
    mimeType,
    extension,
    size: file.size,
    checksum,
    category: categoryOf(originalName),

    collectionId,
    contentSnippet: indexed ? indexed.snippet : "",
    snippetTruncated: indexed ? indexed.truncated : false,

    version: 1,
    versions: [
      {
        version: 1,
        storedName: file.filename,
        originalName,
        mimeType,
        size: file.size,
        checksum,
        uploadedAt: now,
        uploadedBy: user.id,
        note: "Initial upload",
      },
    ],

    downloadCount: 0,
    viewCount: 0,
    starredBy: [],
    status: "active",
    trashedAt: null,
  });

  await activity.record("document.uploaded", {
    req,
    actor: user,
    document: created,
    detail: `${originalName} (${formatBytes(file.size)})`,
  });

  return present(created, { user, accessLevel: "owner" });
}

/** Update metadata only. The file is replaced through `addVersion`. */
async function update({ id, user, body = {}, req }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, "edit");

  const patch = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) throw ApiError.unprocessable("Title cannot be empty", {
      details: [{ field: "title", message: "Required" }],
    });
    patch.title = title;
  }
  if (body.description !== undefined) patch.description = String(body.description).trim();
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);

  if (body.visibility !== undefined) {
    if (!VISIBILITIES.includes(body.visibility)) {
      throw ApiError.unprocessable(`Visibility must be one of: ${VISIBILITIES.join(", ")}`, {
        details: [{ field: "visibility", message: "Invalid value" }],
      });
    }
    // Changing who can see a document is a management action, not an edit.
    if (!access.satisfies(resolved.level, "manage")) {
      throw ApiError.forbidden("Only the owner can change visibility", { code: "INSUFFICIENT_ACCESS" });
    }
    patch.visibility = body.visibility;
  }

  if (!Object.keys(patch).length) throw ApiError.badRequest("Nothing to update");

  const updated = await db.documents.updateById(id, patch);

  await activity.record("document.updated", {
    req,
    actor: user,
    document: updated,
    detail: Object.keys(patch).join(", "),
  });

  return present(updated, { user, accessLevel: resolved.level });
}

/** Attach a new file version, keeping the previous one in history. */
async function addVersion({ id, user, file, body = {}, req }) {
  if (!file) throw ApiError.badRequest("A file is required", { code: "FILE_REQUIRED" });

  const { document, access: resolved } = await access.loadDocumentFor(id, user, "edit");

  await storage.assertContentMatchesExtension(file);
  // Versions are charged to the document's owner, not to whoever uploads them.
  await assertWithinQuota({ userId: document.ownerId, incomingBytes: file.size });

  const originalName = sanitizeFilename(file.originalname);
  const mimeType = mimeTypeOf(originalName, file.mimetype || "application/octet-stream");
  const checksum = await storage.checksumOf(file.path).catch(() => "");
  const nextVersion = (document.version || 1) + 1;
  const now = new Date().toISOString();

  const entry = {
    version: nextVersion,
    storedName: file.filename,
    originalName,
    mimeType,
    size: file.size,
    checksum,
    uploadedAt: now,
    uploadedBy: user.id,
    note: String(body.note || "").trim().slice(0, 200),
  };

  // Re-index: the search snippet must describe the version people now see.
  const indexed = await storage.extractSearchSnippet({
    absolutePath: file.path,
    mimeType,
    extension: extensionOf(originalName),
  });

  const updated = await db.documents.updateById(id, {
    storedName: file.filename,
    originalName,
    mimeType,
    extension: extensionOf(originalName),
    size: file.size,
    checksum,
    category: categoryOf(originalName),
    contentSnippet: indexed ? indexed.snippet : "",
    snippetTruncated: indexed ? indexed.truncated : false,
    version: nextVersion,
    versions: [...(document.versions || []), entry],
  });

  await activity.record("document.version_added", {
    req,
    actor: user,
    document: updated,
    detail: `v${nextVersion} — ${originalName} (${formatBytes(file.size)})`,
  });

  return present(updated, { user, accessLevel: resolved.level });
}

/** Star / unstar for the calling user only. */
async function setStar({ id, user, starred, req }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, "view");

  const current = new Set(document.starredBy || []);
  if (starred) current.add(user.id);
  else current.delete(user.id);

  const updated = await db.documents.updateById(id, { starredBy: [...current] });

  await activity.record(starred ? "document.starred" : "document.unstarred", {
    req,
    actor: user,
    document: updated,
  });

  return present(updated, { user, accessLevel: resolved.level });
}

/** Soft delete — recoverable from the trash. */
async function trash({ id, user, req }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, "manage");

  if (document.status === "trashed") {
    return present(document, { user, accessLevel: resolved.level });
  }

  const updated = await db.documents.updateById(id, {
    status: "trashed",
    trashedAt: new Date().toISOString(),
  });

  await activity.record("document.trashed", { req, actor: user, document: updated });
  return present(updated, { user, accessLevel: resolved.level });
}

async function restore({ id, user, req }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, "manage");

  if (document.status !== "trashed") {
    throw ApiError.badRequest("This document is not in the trash", { code: "NOT_TRASHED" });
  }

  const updated = await db.documents.updateById(id, { status: "active", trashedAt: null });

  await activity.record("document.restored", { req, actor: user, document: updated });
  return present(updated, { user, accessLevel: resolved.level });
}

/**
 * Permanent delete: every stored version, every share, then the record.
 * Audit entries are intentionally retained.
 */
async function destroy({ id, user, req }) {
  const { document } = await access.loadDocumentFor(id, user, "manage");

  const storedNames = new Set([document.storedName, ...(document.versions || []).map((v) => v.storedName)]);
  const removedFiles = await storage.removeFiles([...storedNames]);
  await db.shares.deleteMany({ documentId: id });
  await db.documents.deleteById(id);

  await activity.record("document.deleted", {
    req,
    actor: user,
    document,
    detail: `${removedFiles} file(s) removed from disk`,
  });

  return { deleted: true, id, filesRemoved: removedFiles };
}

/** Permanently delete everything in the caller's trash. */
async function emptyTrash({ user, req }) {
  const trashed = await db.documents.find({ ownerId: user.id, status: "trashed" });

  let filesRemoved = 0;
  for (const document of trashed) {
    const names = new Set([document.storedName, ...(document.versions || []).map((v) => v.storedName)]);
    filesRemoved += await storage.removeFiles([...names]);
    await db.shares.deleteMany({ documentId: document.id });
    await db.documents.deleteById(document.id);
    await activity.record("document.deleted", { req, actor: user, document, detail: "Emptied trash" });
  }

  return { deleted: trashed.length, filesRemoved };
}

/**
 * Resolve everything needed to stream a file.
 * @param {{version?: number|string}} options
 */
async function resolveFile({ id, user, version, requiredLevel = "view" }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, requiredLevel);

  let target = {
    storedName: document.storedName,
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    version: document.version,
  };

  if (version !== undefined && version !== null && String(version) !== "") {
    const wanted = Number.parseInt(version, 10);
    const found = (document.versions || []).find((entry) => entry.version === wanted);
    if (!found) {
      throw ApiError.notFound(`Version ${version} does not exist for this document`, {
        code: "VERSION_NOT_FOUND",
      });
    }
    target = found;
  }

  if (!(await storage.exists(target.storedName))) {
    throw ApiError.notFound("The stored file is missing from disk", { code: "FILE_MISSING" });
  }

  return { document, access: resolved, target, absolutePath: storage.pathFor(target.storedName) };
}

/** Count a download and log it. Called after the response is on its way. */
async function countDownload({ id, user, req, document, detail = "" }) {
  await db.documents.increment(id, { downloadCount: 1 });
  await activity.record("document.downloaded", { req, actor: user, document, detail });
}

/**
 * Apply one mutation to many documents.
 *
 * Each document is authorised individually and failures are *reported* rather
 * than aborting the batch — selecting forty documents and having the whole
 * operation fail because one of them was shared read-only is worse than being
 * told which two were skipped.
 *
 * @param {"trash"|"restore"|"delete"|"star"|"unstar"} action
 */
async function bulk({ user, action, documentIds, req }) {
  const ids = [...new Set((documentIds || []).filter(Boolean))];
  if (!ids.length) {
    throw ApiError.unprocessable("Provide at least one document id", {
      details: [{ field: "documentIds", message: "Required" }],
    });
  }

  const REQUIRED = {
    trash: "manage",
    restore: "manage",
    delete: "manage",
    star: "view",
    unstar: "view",
  };

  const required = REQUIRED[action];
  if (!required) {
    throw ApiError.unprocessable(`Unknown bulk action "${action}"`, {
      details: [{ field: "action", message: `Expected one of: ${Object.keys(REQUIRED).join(", ")}` }],
    });
  }

  const succeeded = [];
  const failed = [];

  for (const id of ids) {
    try {
      if (action === "trash") await trash({ id, user, req: null });
      else if (action === "restore") await restore({ id, user, req: null });
      else if (action === "delete") await destroy({ id, user, req: null });
      else await setStar({ id, user, starred: action === "star", req: null });

      succeeded.push(id);
    } catch (err) {
      failed.push({ id, code: err.code || "FAILED", message: err.message });
    }
  }

  if (!succeeded.length) {
    throw ApiError.forbidden(`None of those documents could be ${action}ed`, {
      code: "BULK_FAILED",
      details: failed,
    });
  }

  // One audit line for the batch instead of forty, with the per-document
  // entries already written by the individual operations above.
  if (action === "trash" || action === "restore") {
    await activity.record(`document.bulk_${action === "trash" ? "trashed" : "restored"}`, {
      req,
      actor: user,
      detail: `${succeeded.length} document(s)`,
    });
  }

  return { action, succeeded: succeeded.length, succeededIds: succeeded, failed };
}

/**
 * Has this owner already uploaded a file with this content hash?
 *
 * The client hashes the file locally (SubtleCrypto) before uploading, so a
 * duplicate can be pointed out *before* spending the bandwidth. Scoped to the
 * owner: knowing whether some other account holds the same bytes is not
 * information a user should be able to probe for.
 */
async function findDuplicate({ user, checksum }) {
  const hash = String(checksum || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw ApiError.unprocessable("checksum must be a hex SHA-256 digest", {
      details: [{ field: "checksum", message: "Expected 64 hex characters" }],
    });
  }

  const match = await db.documents.findOne({ ownerId: user.id, checksum: hash });
  if (!match) return { duplicate: false };

  return {
    duplicate: true,
    document: {
      id: match.id,
      title: match.title,
      originalName: match.originalName,
      sizeLabel: formatBytes(match.size),
      status: match.status,
      createdAt: match.createdAt,
    },
  };
}

/** Distinct tags across everything the caller can see — powers the filter bar. */
async function tagsFor(user) {
  const filter = await buildListFilter({ user, query: { scope: "all" } });
  if (!filter) return [];
  const tags = await db.documents.distinct("tags", filter);
  return tags.sort();
}

module.exports = {
  list,
  getOne,
  create,
  update,
  addVersion,
  setStar,
  trash,
  restore,
  destroy,
  emptyTrash,
  resolveFile,
  countDownload,
  tagsFor,
  present,
  normalizeTags,
  usageBytesFor,
  quotaBytesFor,
  assertWithinQuota,
  accessibleClause,
  bulk,
  findDuplicate,
  VISIBILITIES,
};
