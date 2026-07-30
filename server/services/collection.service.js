"use strict";

/**
 * Collections — a flat, user-owned grouping of documents.
 *
 * The rule that keeps this simple and safe: **a collection is a view, not a
 * grant.** Filing a document you can see into one of your collections changes
 * nothing about who may read it, and a collection's owner gains no rights over
 * the documents inside it. So `assign` checks access to the *document* (view is
 * enough — filing is a personal act) and ownership of the *collection*.
 */

const { db } = require("../data");
const ApiError = require("../utils/ApiError");
const { formatBytes } = require("../utils/files");
const access = require("./access.service");
const activity = require("./activity.service");

const MAX_COLLECTIONS_PER_USER = 60;

const PALETTE = [
  "#5b8cff", "#22d3ee", "#a855f7", "#f472b6",
  "#34d399", "#fbbf24", "#fb7185", "#818cf8",
];

const ICONS = ["files", "star", "shield", "spark", "clock", "users", "link", "grid", "activity"];

function present(row, stats = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    color: row.color || PALETTE[0],
    icon: ICONS.includes(row.icon) ? row.icon : "files",
    position: row.position ?? 0,
    ownerId: row.ownerId,
    documentCount: stats.documentCount ?? 0,
    totalBytes: stats.totalBytes ?? 0,
    totalLabel: formatBytes(stats.totalBytes ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertColor(color) {
  if (color === undefined) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(String(color))) {
    throw ApiError.unprocessable("Colour must be a 6-digit hex value such as #5b8cff", {
      details: [{ field: "color", message: "Invalid hex colour" }],
    });
  }
  return String(color).toLowerCase();
}

/** Load a collection the caller owns, or fail. */
async function loadOwned(collectionId, user) {
  const row = await db.collections.findById(collectionId);

  // 404 rather than 403 for someone else's collection: the id should not be
  // confirmable by a stranger.
  if (!row || row.ownerId !== user.id) {
    throw ApiError.notFound("Collection not found", { code: "COLLECTION_NOT_FOUND" });
  }
  return row;
}

/** Every collection the user owns, with live document counts. */
async function list({ user }) {
  const rows = await db.collections.find({ ownerId: user.id }, { sort: { position: 1, createdAt: 1 } });

  const collections = await Promise.all(
    rows.map(async (row) => {
      const documents = await db.documents.find({ collectionId: row.id, status: "active" });
      return present(row, {
        documentCount: documents.length,
        totalBytes: documents.reduce((sum, doc) => sum + (Number(doc.size) || 0), 0),
      });
    })
  );

  const unfiled = await db.documents.count({
    ownerId: user.id,
    status: "active",
    collectionId: null,
  });

  return { collections, unfiled };
}

async function create({ user, body = {}, req }) {
  const name = String(body.name || "").trim();
  if (!name) {
    throw ApiError.unprocessable("A collection needs a name", {
      details: [{ field: "name", message: "Required" }],
    });
  }

  const existingCount = await db.collections.count({ ownerId: user.id });
  if (existingCount >= MAX_COLLECTIONS_PER_USER) {
    throw ApiError.badRequest(`You can have at most ${MAX_COLLECTIONS_PER_USER} collections`, {
      code: "TOO_MANY_COLLECTIONS",
    });
  }

  const duplicate = await db.collections.findOne({ ownerId: user.id, name });
  if (duplicate) {
    throw ApiError.conflict("You already have a collection with that name", {
      code: "COLLECTION_NAME_TAKEN",
      details: [{ field: "name", message: "Already in use" }],
    });
  }

  const created = await db.collections.create({
    name,
    description: String(body.description || "").trim(),
    color: assertColor(body.color) || PALETTE[existingCount % PALETTE.length],
    icon: ICONS.includes(body.icon) ? body.icon : "files",
    ownerId: user.id,
    position: existingCount,
  });

  await activity.record("collection.created", { req, actor: user, detail: name });
  return present(created);
}

async function update({ id, user, body = {}, req }) {
  const row = await loadOwned(id, user);

  const patch = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) {
      throw ApiError.unprocessable("A collection needs a name", {
        details: [{ field: "name", message: "Required" }],
      });
    }
    if (name !== row.name) {
      const clash = await db.collections.findOne({ ownerId: user.id, name });
      if (clash) {
        throw ApiError.conflict("You already have a collection with that name", {
          code: "COLLECTION_NAME_TAKEN",
        });
      }
    }
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = String(body.description).trim();
  if (body.color !== undefined) patch.color = assertColor(body.color);
  if (body.icon !== undefined) {
    if (!ICONS.includes(body.icon)) {
      throw ApiError.unprocessable(`Icon must be one of: ${ICONS.join(", ")}`, {
        details: [{ field: "icon", message: "Unknown icon" }],
      });
    }
    patch.icon = body.icon;
  }
  if (body.position !== undefined) {
    const position = Number(body.position);
    if (!Number.isFinite(position) || position < 0) {
      throw ApiError.unprocessable("position must be a non-negative number", {
        details: [{ field: "position", message: "Invalid" }],
      });
    }
    patch.position = position;
  }

  if (!Object.keys(patch).length) throw ApiError.badRequest("Nothing to update");

  const updated = await db.collections.updateById(id, patch);
  await activity.record("collection.updated", {
    req,
    actor: user,
    detail: `${row.name}: ${Object.keys(patch).join(", ")}`,
  });

  return present(updated);
}

/**
 * Delete a collection. Documents are never deleted with it — they become
 * unfiled, which is the behaviour people expect from a label and the only
 * non-destructive choice available.
 */
async function remove({ id, user, req }) {
  const row = await loadOwned(id, user);

  const unfiled = await db.documents.updateMany({ collectionId: id }, { collectionId: null });
  await db.collections.deleteById(id);

  await activity.record("collection.deleted", {
    req,
    actor: user,
    detail: `${row.name} — ${unfiled} document(s) returned to Unfiled`,
  });

  return { deleted: true, id, documentsUnfiled: unfiled };
}

/**
 * File documents into a collection, or clear them with `collectionId: null`.
 *
 * Each document is checked individually and inaccessible ids are reported rather
 * than silently skipped, so a bulk drag that partially fails says so.
 */
async function assign({ user, collectionId, documentIds, req }) {
  const ids = [...new Set((Array.isArray(documentIds) ? documentIds : [documentIds]).filter(Boolean))];
  if (!ids.length) {
    throw ApiError.unprocessable("Provide at least one document id", {
      details: [{ field: "documentIds", message: "Required" }],
    });
  }

  const target = collectionId ? await loadOwned(collectionId, user) : null;

  const moved = [];
  const refused = [];

  for (const documentId of ids) {
    try {
      // View access is the bar: filing someone else's shared document into your
      // own collection is organising your view, not editing their document.
      const { document } = await access.loadDocumentFor(documentId, user, "view");
      await db.documents.updateById(document.id, { collectionId: target ? target.id : null });
      moved.push(document.id);
    } catch (err) {
      refused.push({ id: documentId, reason: err.code || "UNAVAILABLE" });
    }
  }

  if (!moved.length) {
    throw ApiError.forbidden("None of those documents could be filed", {
      code: "ASSIGN_FAILED",
      details: refused,
    });
  }

  await activity.record(target ? "collection.documents_added" : "collection.documents_removed", {
    req,
    actor: user,
    detail: `${moved.length} document(s)${target ? ` -> ${target.name}` : " -> Unfiled"}`,
  });

  return {
    collectionId: target ? target.id : null,
    moved: moved.length,
    movedIds: moved,
    refused,
  };
}

module.exports = { list, create, update, remove, assign, present, loadOwned, PALETTE, ICONS };
