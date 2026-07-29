"use strict";

const asyncHandler = require("../utils/asyncHandler");
const statsService = require("../services/stats.service");
const activityService = require("../services/activity.service");

exports.overview = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(7, Number.parseInt(req.query.days, 10) || 14));
  res.json(await statsService.overview({ user: req.user, days }));
});

exports.system = asyncHandler(async (req, res) => {
  res.json(await statsService.systemHealth());
});

exports.activityFeed = asyncHandler(async (req, res) => {
  res.json(await activityService.list({ query: req.query, action: req.query.action }));
});
