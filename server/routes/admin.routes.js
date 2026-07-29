"use strict";

const express = require("express");
const { body, param, query } = require("express-validator");

const controller = require("../controllers/admin.controller");
const validate = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { OBJECT_ID_PATTERN } = require("../utils/ids");
const { ROLES } = require("../services/admin.service");

const router = express.Router();

// Every route here is admin-only, enforced server-side rather than by hiding
// the navigation entry in the client.
router.use(requireAuth, requireRole("admin"));

router.get(
  "/users",
  [
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("role").optional().isIn(ROLES),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  controller.listUsers
);

router.patch(
  "/users/:id",
  [
    param("id").matches(OBJECT_ID_PATTERN).withMessage("Not a valid user id"),
    body("role").optional().isIn(ROLES),
    body("isActive").optional().isBoolean(),
    body("storageQuotaGb").optional().isFloat({ min: 0, max: 10000 }),
  ],
  validate,
  controller.updateUser
);

router.get("/storage", controller.reconcileStorage);
router.post("/storage/purge-orphans", controller.purgeOrphans);
router.post("/maintenance/run", controller.runMaintenance);

module.exports = router;
