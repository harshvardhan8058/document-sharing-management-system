"use strict";

const { db } = require("../data");
const ApiError = require("../utils/ApiError");

/**
 * Authorization for documents — the single place that answers
 * "what may this person do with this document?".
 *
 * The original code had no answer at all: its `authenticate` middleware was
 * `if (req.body) next()`, so any caller could read, edit or delete anything.
 */
const RANK = { none: 0, view: 1, edit: 2, manage: 3, owner: 4 };

/** A share row only counts while it is un-revoked and un-expired. */
function isShareLive(share, now = Date.now()) {
  if (!share || share.revokedAt) return false;
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= now) return false;
  return true;
}

/** Live per-user grants for a document. */
async function liveUserShares(documentId) {
  const shares = await db.shares.find({ documentId, type: "user", revokedAt: null });
  const now = Date.now();
  return shares.filter((share) => isShareLive(share, now));
}

/**
 * Determine the effective permission level.
 *
 * Grants are matched by user id *or* email so a document can be shared with
 * someone before they have registered; their access starts working the moment
 * they sign up with that address.
 *
 * @param {object} document
 * @param {object|null} user
 * @returns {Promise<{level: keyof RANK, via: string, share?: object}>}
 */
async function resolve(document, user) {
  if (!document) return { level: "none", via: "missing" };

  if (user && document.ownerId === user.id) return { level: "owner", via: "owner" };

  // Admins get management rights for moderation, but never ownership.
  if (user && user.role === "admin") return { level: "manage", via: "admin" };

  // Trashed documents are visible to their owner and admins only — both handled above.
  if (document.status === "trashed") return { level: "none", via: "trashed" };

  if (user) {
    const shares = await liveUserShares(document.id);
    const mine = shares.find(
      (share) => (share.userId && share.userId === user.id) || (share.email && share.email === user.email)
    );
    if (mine) return { level: mine.permission, via: "share", share: mine };
  }

  if (document.visibility === "public") return { level: "view", via: "public" };
  if (document.visibility === "internal" && user) return { level: "view", via: "internal" };

  return { level: "none", via: "denied" };
}

/** True when `level` satisfies `required`. */
function satisfies(level, required) {
  return (RANK[level] || 0) >= (RANK[required] || 0);
}

/**
 * Fetch a document and assert the caller has at least `required` access.
 *
 * Insufficient access is reported as 404, not 403, so the endpoint cannot be
 * used to probe which document ids exist. The one exception is when the caller
 * *can* see the document but not perform the action — then 403 is the honest,
 * non-leaking answer.
 */
async function loadDocumentFor(documentId, user, required = "view") {
  const document = await db.documents.findById(documentId);
  if (!document) throw ApiError.notFound("Document not found", { code: "DOCUMENT_NOT_FOUND" });

  const access = await resolve(document, user);

  if (!satisfies(access.level, "view")) {
    throw ApiError.notFound("Document not found", { code: "DOCUMENT_NOT_FOUND" });
  }
  if (!satisfies(access.level, required)) {
    throw ApiError.forbidden(`You need ${required} access to do that`, {
      code: "INSUFFICIENT_ACCESS",
      details: [{ required, actual: access.level }],
    });
  }

  return { document, access };
}

/**
 * Ids of documents shared directly with a user, resolved by id or email.
 * Used to build the "Shared with me" listing.
 */
async function documentIdsSharedWith(user) {
  if (!user) return [];
  const shares = await db.shares.find({
    type: "user",
    revokedAt: null,
    $or: [{ userId: user.id }, { email: user.email }],
  });
  const now = Date.now();
  return [...new Set(shares.filter((share) => isShareLive(share, now)).map((share) => share.documentId))];
}

module.exports = { resolve, satisfies, loadDocumentFor, liveUserShares, documentIdsSharedWith, isShareLive, RANK };
