"use strict";

const { db } = require("../data");
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
    clauses.push({ starredBy: user.id, status: "active" });
  } else if (user.role === "admin") {
    clauses.push({ status: "active" });
  } else {
    const sharedIds = await access.documentIdsSharedWith(user);
    clauses.push({
      status: "active",
      $or: [
        { ownerId: user.id },
        ...(sharedIds.length ? [{ id: { $in: sharedIds } }] : []),
        { visibility: { $in: ["internal", "public"] } },
      ],
    });
  }

  if (query.search) {
    const pattern = escapeRegex(String(query.search).trim());
    if (pattern) {
      clauses.push({
        $or: [
          { title: { $regex: pattern, $options: "i" } },
          { description: { $regex: pattern, $options: "i" } },
          { originalName: { $regex: pattern, $options: "i" } },
          { tags: { $regex: pattern, $options: "i" } },
        ],
      });
    }
  }

  if (query.category) clauses.push({ category: String(query.category) });
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
  const documents = await Promise.all(
    records.map(async (record) => {
      const resolved = await access.resolve(record, user);
      return present(record, { user, accessLevel: resolved.level });
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

  const originalName = sanitizeFilename(file.originalname);
  const extension = extensionOf(originalName);
  const now = new Date().toISOString();

  // Trust our own extension mapping over the client-declared Content-Type.
  const mimeType = mimeTypeOf(originalName, file.mimetype || "application/octet-stream");
  const checksum = await storage.checksumOf(file.path).catch(() => "");

  const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : "private";
  const title = String(body.title || "").trim() || originalName;

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

  const updated = await db.documents.updateById(id, {
    storedName: file.filename,
    originalName,
    mimeType,
    extension: extensionOf(originalName),
    size: file.size,
    checksum,
    category: categoryOf(originalName),
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
  VISIBILITIES,
};
