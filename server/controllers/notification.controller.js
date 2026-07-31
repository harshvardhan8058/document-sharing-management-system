"use strict";

const asyncHandler = require("../utils/asyncHandler");
const notificationService = require("../services/notification.service");
const events = require("../services/events.service");

exports.list = asyncHandler(async (req, res) => {
  res.json(await notificationService.list({ userId: req.user.id, query: req.query }));
});

exports.unreadCount = asyncHandler(async (req, res) => {
  res.json({ unread: await notificationService.countUnread(req.user.id) });
});

exports.markRead = asyncHandler(async (req, res) => {
  res.json(await notificationService.markRead({ userId: req.user.id, notificationId: req.params.id }));
});

exports.markAllRead = asyncHandler(async (req, res) => {
  res.json(await notificationService.markAllRead(req.user.id));
});

exports.clearRead = asyncHandler(async (req, res) => {
  res.json(await notificationService.clearRead(req.user.id));
});

/**
 * Exchange the caller's bearer token for a single-use stream ticket.
 * EventSource cannot send an Authorization header — see events.service.js.
 */
exports.streamTicket = asyncHandler(async (req, res) => {
  res.json(events.issueTicket(req.user.id));
});

/**
 * The event stream itself. Authenticated by ticket rather than by the usual
 * middleware, so it is deliberately mounted outside `requireAuth`.
 */
exports.stream = asyncHandler(async (req, res) => {
  const userId = events.consumeTicket(req.query.ticket);

  // Long-lived response: no compression (it buffers) and no request timeout.
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  events.subscribe(userId, res, req);
});
