"use strict";

/**
 * In-app notifications.
 *
 * Sharing a document used to be silent — the recipient had no way to learn about
 * it short of noticing a new row in "Shared with me". There is no outbound mail
 * in this deployment, so the product tells them itself.
 *
 * Every write also pushes over the event bus, so an open tab updates without
 * polling. Delivery is best-effort; the stored row is the source of truth.
 */

const { db } = require("../data");
const logger = require("../utils/logger");
const { readPagination, buildMeta } = require("../utils/pagination");
const events = require("./events.service");

/** Notifications a user has explicitly asked not to receive would go here. */
const SELF_SUPPRESSED = new Set(["comment.created", "comment.reply", "comment.mention"]);

function present(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body || "",
    documentId: row.documentId || null,
    documentTitle: row.documentTitle || "",
    commentId: row.commentId || null,
    actor: row.actorId
      ? { id: row.actorId, name: row.actorName || "Someone", accentColor: row.actorAccent || "#5b8cff" }
      : null,
    read: Boolean(row.readAt),
    readAt: row.readAt || null,
    createdAt: row.createdAt,
  };
}

/**
 * Create a notification and push it live.
 *
 * Never throws: a notification is a courtesy layered on top of an action that
 * has already succeeded, so failing to record one must not fail the upload,
 * share or comment that triggered it.
 *
 * @param {object} input
 * @param {string} input.userId recipient
 * @param {object|null} [input.actor] the user who caused it; skipped if it is the recipient
 */
async function notify({ userId, type, title, body = "", document = null, commentId = null, actor = null }) {
  if (!userId) return null;

  // Never tell someone about their own action.
  if (actor && actor.id === userId && SELF_SUPPRESSED.has(type)) return null;
  if (actor && actor.id === userId) return null;

  try {
    const created = await db.notifications.create({
      userId,
      type,
      title,
      body,
      documentId: document ? document.id : null,
      documentTitle: document ? document.title : "",
      commentId,
      actorId: actor ? actor.id : null,
      actorName: actor ? actor.fullName || `${actor.firstName || ""} ${actor.lastName || ""}`.trim() : "",
      actorAccent: (actor && actor.accentColor) || "#5b8cff",
      readAt: null,
    });

    const payload = present(created);
    const unread = await countUnread(userId);

    events.publish(userId, "notification", { notification: payload, unread });

    return payload;
  } catch (err) {
    logger.warn(`Could not record notification "${type}" for ${userId}: ${err.message}`);
    return null;
  }
}

/** Notify several recipients of the same thing. */
async function notifyMany(userIds, template) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  const created = [];
  for (const userId of unique) {
    const row = await notify({ ...template, userId });
    if (row) created.push(row);
  }
  return created;
}

function countUnread(userId) {
  return db.notifications.count({ userId, readAt: null });
}

/** Paginated list, newest first. `unreadOnly` powers the badge-filtered view. */
async function list({ userId, query = {} }) {
  const { page, limit, skip } = readPagination({ limit: 20, ...query });

  const filter = { userId };
  if (query.unreadOnly === "true" || query.unreadOnly === true) filter.readAt = null;
  if (query.type) filter.type = String(query.type);

  const [rows, total, unread] = await Promise.all([
    db.notifications.find(filter, { sort: { createdAt: -1 }, skip, limit }),
    db.notifications.count(filter),
    countUnread(userId),
  ]);

  return {
    notifications: rows.map(present),
    unread,
    meta: buildMeta({ page, limit, total }),
  };
}

/** Mark one notification read. Scoped by userId so ids cannot be guessed across accounts. */
async function markRead({ userId, notificationId }) {
  const row = await db.notifications.findById(notificationId);
  if (!row || row.userId !== userId) return { updated: 0, unread: await countUnread(userId) };

  if (!row.readAt) await db.notifications.updateById(notificationId, { readAt: new Date().toISOString() });

  const unread = await countUnread(userId);
  events.publish(userId, "notifications.read", { ids: [notificationId], unread });

  return { updated: 1, unread };
}

async function markAllRead(userId) {
  const updated = await db.notifications.updateMany(
    { userId, readAt: null },
    { readAt: new Date().toISOString() }
  );

  events.publish(userId, "notifications.read", { all: true, unread: 0 });
  return { updated, unread: 0 };
}

async function clearRead(userId) {
  const removed = await db.notifications.deleteMany({ userId, readAt: { $ne: null } });
  return { removed, unread: await countUnread(userId) };
}

/** Retention hook, called by the maintenance sweep. */
async function prune(days) {
  if (!days || days <= 0) return { skipped: true, removed: 0 };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return { skipped: false, removed: await db.notifications.deleteMany({ createdAt: { $lt: cutoff } }) };
}

module.exports = {
  notify,
  notifyMany,
  list,
  countUnread,
  markRead,
  markAllRead,
  clearRead,
  prune,
  present,
};
