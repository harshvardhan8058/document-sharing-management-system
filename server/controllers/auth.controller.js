"use strict";

const asyncHandler = require("../utils/asyncHandler");
const authService = require("../services/auth.service");
const activityService = require("../services/activity.service");
const { scorePassword } = require("../utils/password");

exports.register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);
  res.status(201).json(result);
});

exports.login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  res.json(result);
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: await authService.getById(req.user.id) });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  res.json({ user: await authService.updateProfile(req.user.id, req.body, req) });
});

exports.changePassword = asyncHandler(async (req, res) => {
  res.json(await authService.changePassword(req.user.id, req.body, req));
});

/** Invalidate every token for this account, including the one making the call. */
exports.revokeSessions = asyncHandler(async (req, res) => {
  res.json(await authService.revokeAllSessions(req.user.id, req));
});

/** People picker for the share dialog. */
exports.directory = asyncHandler(async (req, res) => {
  const users = await authService.directory({
    search: req.query.search,
    excludeUserId: req.user.id,
    limit: Number.parseInt(req.query.limit, 10) || 20,
  });
  res.json({ users });
});

/** The caller's own audit trail. */
exports.myActivity = asyncHandler(async (req, res) => {
  res.json(await activityService.list({ actorId: req.user.id, query: req.query }));
});

/**
 * Stateless password strength check, used to drive the live meter on the
 * sign-up form so the rules cannot drift between client and server.
 */
exports.checkPasswordStrength = asyncHandler(async (req, res) => {
  res.json(scorePassword(String(req.body.password || "")));
});
