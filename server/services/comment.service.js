"use strict";

/**
 * Discussion on a document.
 *
 * Access follows the document, always: if you can view it you can read the
 * thread, and commenting needs view access too — a reviewer with read-only
 * access still needs to be able to say "this section is wrong". Editing and
 * deleting are limited to the author, with document managers able to remove
 * anything on a document they manage (moderation without impersonation).
 */

const { db } = require("../data");
const ApiError = require("../utils/ApiError");
const { readPagination, buildMeta } = require("../utils/pagination");

const access = require("./access.service");
const activity = require("./activity.service");
const notifications = require("./notification.service");
const events = require("./events.service");

const MAX_BODY = 4000;
const MAX_MENTIONS = 15;

/** `@name`, `@first.last`, or `@email@example.com`. */
const MENTION_PATTERN = /@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;

/**
 * Turn `@handles` in a comment into real user ids.
 *
 * Matched against the local part of an email as well as the full address, so
 * `@rio` finds `rio@dsms.dev` — that is how people actually type. Unmatched
 * handles are returned so the UI can show them as plain text instead of
 * pretending someone was notified.
 */
async function resolveMentions(body) {
  const handles = [...new Set(Array.from(String(body).matchAll(MENTION_PATTERN), (m) => m[1].toLowerCase()))]
    .slice(0, MAX_MENTIONS);

  if (!handles.length) return { userIds: [], resolved: [], unresolved: [] };

  const candidates = await db.users.find({ isActive: { $ne: false } });

  const resolved = [];
  const unresolved = [];

  for (const handle of handles) {
    const match = candidates.find((user) => {
      const email = String(user.email || "").toLowerCase();
      return email === handle || email.split("@")[0] === handle;
    });

    if (match) resolved.push({ handle, userId: match.id, email: match.email });
    else unresolved.push(handle);
  }

  return { userIds: resolved.map((entry) => entry.userId), resolved, unresolved };
}

function present(row, { viewer } = {}) {
  const deleted = Boolean(row.deletedAt);

  return {
    id: row.id,
    documentId: row.documentId,
    parentId: row.parentId || null,
    author: {
      id: row.authorId,
      name: row.authorName || "Unknown",
      accentColor: row.authorAccent || "#5b8cff",
    },
    // A removed comment keeps its place in the thread but not its content.
    body: deleted ? "" : row.body,
    deleted,
    mentions: row.mentions || [],
    edited: Boolean(row.editedAt),
    editedAt: row.editedAt || null,
    isMine: Boolean(viewer && viewer.id === row.authorId),
    createdAt: row.createdAt,
  };
}

/** Everyone already involved in a document, for "someone commented" fan-out. */
async function participantsFor(document) {
  const [comments, shares] = await Promise.all([
    db.comments.find({ documentId: document.id }),
    db.shares.find({ documentId: document.id, type: "user", revokedAt: null }),
  ]);

  return [
    ...new Set([
      document.ownerId,
      ...comments.map((comment) => comment.authorId),
      ...shares.map((share) => share.userId).filter(Boolean),
    ]),
  ];
}

/** The thread for a document, oldest first, with replies grouped under parents. */
async function listForDocument({ id, user, query = {} }) {
  const { document } = await access.loadDocumentFor(id, user, "view");
  const { page, limit, skip } = readPagination({ limit: 50, ...query });

  const [rows, total] = await Promise.all([
    db.comments.find({ documentId: document.id }, { sort: { createdAt: 1 }, skip, limit }),
    db.comments.count({ documentId: document.id }),
  ]);

  const presented = rows.map((row) => present(row, { viewer: user }));
  const byId = new Map(presented.map((comment) => [comment.id, { ...comment, replies: [] }]));

  const threads = [];
  for (const comment of byId.values()) {
    const parent = comment.parentId ? byId.get(comment.parentId) : null;
    if (parent) parent.replies.push(comment);
    else threads.push(comment);
  }

  return { comments: threads, flat: presented, meta: buildMeta({ page, limit, total }) };
}

async function create({ id, user, body = {}, req }) {
  const { document } = await access.loadDocumentFor(id, user, "view");

  const text = String(body.body || "").trim();
  if (!text) {
    throw ApiError.unprocessable("A comment cannot be empty", {
      details: [{ field: "body", message: "Required" }],
    });
  }
  if (text.length > MAX_BODY) {
    throw ApiError.unprocessable(`Comments are limited to ${MAX_BODY} characters`, {
      details: [{ field: "body", message: "Too long" }],
    });
  }

  let parentId = null;
  if (body.parentId) {
    const parent = await db.comments.findById(String(body.parentId));
    if (!parent || parent.documentId !== document.id) {
      throw ApiError.notFound("The comment being replied to does not exist", { code: "PARENT_NOT_FOUND" });
    }
    // One level only: a reply to a reply attaches to the same parent, which
    // keeps threads readable instead of drifting rightwards forever.
    parentId = parent.parentId || parent.id;
  }

  const { userIds: mentionIds, unresolved } = await resolveMentions(text);

  const created = await db.comments.create({
    documentId: document.id,
    parentId,
    authorId: user.id,
    authorName: user.fullName,
    authorAccent: user.accentColor || "#5b8cff",
    body: text,
    mentions: mentionIds,
    editedAt: null,
    deletedAt: null,
  });

  await activity.record("comment.created", {
    req,
    actor: user,
    document,
    detail: text.length > 80 ? `${text.slice(0, 77)}…` : text,
  });

  // Mentions take precedence, so nobody gets two notifications for one comment.
  const mentioned = mentionIds.filter((userId) => userId !== user.id);
  await notifications.notifyMany(mentioned, {
    type: "comment.mention",
    title: `${user.fullName} mentioned you`,
    body: text.slice(0, 160),
    document,
    commentId: created.id,
    actor: user,
  });

  const others = (await participantsFor(document)).filter(
    (userId) => userId !== user.id && !mentioned.includes(userId)
  );
  await notifications.notifyMany(others, {
    type: parentId ? "comment.reply" : "comment.created",
    title: `${user.fullName} commented on “${document.title}”`,
    body: text.slice(0, 160),
    document,
    commentId: created.id,
    actor: user,
  });

  const payload = present(created, { viewer: user });

  // Live-update anyone with the document open, including the author's other tabs.
  events.publishToMany(await participantsFor(document), "comment.created", {
    documentId: document.id,
    comment: { ...payload, isMine: false },
  });

  return { comment: payload, unresolvedMentions: unresolved };
}

async function update({ id, commentId, user, body = {}, req }) {
  const { document } = await access.loadDocumentFor(id, user, "view");

  const row = await db.comments.findById(commentId);
  if (!row || row.documentId !== document.id || row.deletedAt) {
    throw ApiError.notFound("Comment not found", { code: "COMMENT_NOT_FOUND" });
  }
  if (row.authorId !== user.id) {
    throw ApiError.forbidden("You can only edit your own comments", { code: "NOT_COMMENT_AUTHOR" });
  }

  const text = String(body.body || "").trim();
  if (!text) {
    throw ApiError.unprocessable("A comment cannot be empty", {
      details: [{ field: "body", message: "Required" }],
    });
  }

  const { userIds: mentionIds } = await resolveMentions(text);

  const updated = await db.comments.updateById(commentId, {
    body: text.slice(0, MAX_BODY),
    mentions: mentionIds,
    editedAt: new Date().toISOString(),
  });

  const payload = present(updated, { viewer: user });
  events.publishToMany(await participantsFor(document), "comment.updated", {
    documentId: document.id,
    comment: { ...payload, isMine: false },
  });

  return { comment: payload };
}

/**
 * Soft-delete a comment. The author may remove their own; anyone who manages the
 * document may remove any of them.
 */
async function remove({ id, commentId, user, req }) {
  const { document, access: resolved } = await access.loadDocumentFor(id, user, "view");

  const row = await db.comments.findById(commentId);
  if (!row || row.documentId !== document.id) {
    throw ApiError.notFound("Comment not found", { code: "COMMENT_NOT_FOUND" });
  }

  const isAuthor = row.authorId === user.id;
  const canModerate = access.satisfies(resolved.level, "manage");

  if (!isAuthor && !canModerate) {
    throw ApiError.forbidden("You can only delete your own comments", { code: "NOT_COMMENT_AUTHOR" });
  }
  if (row.deletedAt) return { deleted: true, id: commentId, alreadyDeleted: true };

  await db.comments.updateById(commentId, {
    deletedAt: new Date().toISOString(),
    body: "",
    mentions: [],
  });

  await activity.record("comment.deleted", {
    req,
    actor: user,
    document,
    detail: isAuthor ? "own comment" : `comment by ${row.authorName} (moderated)`,
  });

  events.publishToMany(await participantsFor(document), "comment.deleted", {
    documentId: document.id,
    commentId,
  });

  return { deleted: true, id: commentId, moderated: !isAuthor };
}

/** Count for the drawer tab badge. */
function countForDocument(documentId) {
  return db.comments.count({ documentId, deletedAt: null });
}

module.exports = {
  listForDocument,
  create,
  update,
  remove,
  countForDocument,
  resolveMentions,
  present,
  participantsFor,
  MAX_BODY,
};
