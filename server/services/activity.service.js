"use strict";

const { db } = require("../data");
const logger = require("../utils/logger");
const { readPagination, buildMeta } = require("../utils/pagination");

/** Actions the audit trail understands, with UI-friendly labels. */
const ACTIONS = {
  "user.registered": "Created their account",
  "user.login": "Signed in",
  "user.profile_updated": "Updated their profile",
  "user.password_changed": "Changed their password",
  "user.sessions_revoked": "Signed out of every session",
  "admin.user_updated": "Updated an account",

  "document.uploaded": "Uploaded",
  "document.updated": "Updated details for",
  "document.version_added": "Uploaded a new version of",
  "document.downloaded": "Downloaded",
  "document.viewed": "Viewed",
  "document.starred": "Starred",
  "document.unstarred": "Removed the star from",
  "document.trashed": "Moved to trash",
  "document.restored": "Restored",
  "document.deleted": "Permanently deleted",

  "collection.created": "Created the collection",
  "collection.updated": "Updated the collection",
  "collection.deleted": "Deleted the collection",
  "collection.documents_added": "Filed documents into a collection",
  "collection.documents_removed": "Removed documents from a collection",

  "comment.created": "Commented on",
  "comment.deleted": "Deleted a comment on",

  "document.bulk_trashed": "Moved several documents to trash",
  "document.bulk_restored": "Restored several documents",

  "share.user_granted": "Shared",
  "share.user_revoked": "Stopped sharing",
  "share.link_created": "Created a public link for",
  "share.link_revoked": "Revoked the public link for",
  "share.link_accessed": "Opened a shared link to",
};

function clientIp(req) {
  if (!req) return "";
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.ip || "";
}

/**
 * Append an audit entry.
 *
 * Deliberately best-effort: an audit write must never turn a successful upload
 * into a failed request, so failures are logged and swallowed.
 */
async function record(action, { req, actor, document, detail = "" } = {}) {
  try {
    await db.activities.create({
      action,
      detail,
      documentId: document ? document.id : null,
      documentTitle: document ? document.title : "",
      actorId: actor ? actor.id : null,
      actorName: actor ? actor.fullName || `${actor.firstName || ""} ${actor.lastName || ""}`.trim() : "Anonymous",
      ip: clientIp(req),
      userAgent: req ? String(req.headers["user-agent"] || "").slice(0, 250) : "",
    });
  } catch (err) {
    logger.warn(`Failed to record activity "${action}": ${err.message}`);
  }
}

function decorate(entry) {
  return { ...entry, label: ACTIONS[entry.action] || entry.action };
}

/** Recent entries for one document. */
async function listForDocument(documentId, limit = 30) {
  const entries = await db.activities.find({ documentId }, { sort: { createdAt: -1 }, limit });
  return entries.map(decorate);
}

/** Paginated feed, optionally scoped to an actor and/or a set of documents. */
async function list({ actorId, documentIds, action, query = {} } = {}) {
  const { page, limit, skip } = readPagination(query);

  const filter = {};
  const clauses = [];
  if (actorId) clauses.push({ actorId });
  if (documentIds) clauses.push({ documentId: { $in: documentIds } });
  if (clauses.length === 1) Object.assign(filter, clauses[0]);
  else if (clauses.length > 1) filter.$or = clauses;
  if (action) filter.action = action;

  const [entries, total] = await Promise.all([
    db.activities.find(filter, { sort: { createdAt: -1 }, skip, limit }),
    db.activities.count(filter),
  ]);

  return { activities: entries.map(decorate), meta: buildMeta({ page, limit, total }) };
}

module.exports = { record, list, listForDocument, decorate, ACTIONS };
