"use strict";

const asyncHandler = require("../utils/asyncHandler");
const adminService = require("../services/admin.service");
const maintenance = require("../services/maintenance.service");

exports.listUsers = asyncHandler(async (req, res) => {
  res.json(await adminService.listUsers({ query: req.query }));
});

exports.updateUser = asyncHandler(async (req, res) => {
  res.json(
    await adminService.updateUser({
      actor: req.user,
      userId: req.params.id,
      body: req.body,
      req,
    })
  );
});

exports.reconcileStorage = asyncHandler(async (req, res) => {
  res.json(await adminService.reconcileStorage());
});

exports.purgeOrphans = asyncHandler(async (req, res) => {
  res.json(await adminService.purgeOrphanedFiles({ actor: req.user, req }));
});

/** Run the retention sweeps on demand rather than waiting for the timer. */
exports.runMaintenance = asyncHandler(async (req, res) => {
  res.json(await maintenance.sweep({ reason: "manual" }));
});
