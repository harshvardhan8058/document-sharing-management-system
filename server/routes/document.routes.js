"use strict";

const express = require("express");
const { body, param, query } = require("express-validator");

const controller = require("../controllers/document.controller");
const shareController = require("../controllers/share.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { singleFile } = require("../middleware/upload");
const { SORT_OPTIONS } = require("../utils/pagination");
const { VISIBILITIES } = require("../services/document.service");
const { PERMISSIONS } = require("../services/share.service");
const { OBJECT_ID_PATTERN } = require("../utils/ids");

const router = express.Router();

// Every document route requires a real, verified identity.
router.use(requireAuth);

const documentId = param("id")
  .matches(OBJECT_ID_PATTERN)
  .withMessage("Not a valid document id");

const metadataRules = [
  body("title").optional().isString().trim().isLength({ min: 1, max: 180 }).withMessage("Title must be 1-180 characters"),
  body("description").optional().isString().trim().isLength({ max: 2000 }).withMessage("Description is too long"),
  body("visibility").optional().isIn(VISIBILITIES).withMessage(`Visibility must be one of: ${VISIBILITIES.join(", ")}`),
];

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

router.get(
  "/",
  [
    query("scope").optional().isIn(["all", "mine", "shared", "starred", "trash"]),
    query("sort").optional().isIn(Object.keys(SORT_OPTIONS)),
    query("visibility").optional().isIn(VISIBILITIES),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("search").optional().isString().trim().isLength({ max: 120 }),
  ],
  validate,
  controller.list
);

/**
 * Static segments are declared before `/:id` — Express matches in order, so
 * `/tags` registered after `/:id` would be swallowed by the id route.
 */
router.get("/tags", controller.tags);

router.delete("/trash/empty", controller.emptyTrash);

router.post("/", singleFile("file"), metadataRules, validate, controller.create);

// ---------------------------------------------------------------------------
// Single document
// ---------------------------------------------------------------------------

router.get("/:id", [documentId], validate, controller.getOne);

router.patch("/:id", [documentId, ...metadataRules], validate, controller.update);

router.post(
  "/:id/versions",
  [documentId],
  validate,
  singleFile("file"),
  [body("note").optional().isString().trim().isLength({ max: 200 })],
  validate,
  controller.addVersion
);

router.get(
  "/:id/download",
  [documentId, query("version").optional().isInt({ min: 1 })],
  validate,
  controller.download
);

router.get(
  "/:id/preview",
  [documentId, query("version").optional().isInt({ min: 1 })],
  validate,
  controller.preview
);

router.get(
  "/:id/preview/text",
  [documentId, query("version").optional().isInt({ min: 1 })],
  validate,
  controller.textPreview
);

router.put("/:id/star", [documentId], validate, controller.star);
router.delete("/:id/star", [documentId], validate, controller.star);

router.post("/:id/trash", [documentId], validate, controller.trash);
router.post("/:id/restore", [documentId], validate, controller.restore);

/** Soft delete by default; `?permanent=true` deletes the files too. */
router.delete(
  "/:id",
  [documentId, query("permanent").optional().isBoolean()],
  validate,
  (req, res, next) => {
    const permanent = req.query.permanent === "true" || req.query.permanent === true;
    return permanent ? controller.destroy(req, res, next) : controller.trash(req, res, next);
  }
);

// ---------------------------------------------------------------------------
// Sharing (owner side)
// ---------------------------------------------------------------------------

router.get("/:id/shares", [documentId], validate, shareController.listForDocument);

router.post(
  "/:id/shares",
  [
    documentId,
    body("email").isEmail().withMessage("Enter a valid email address").normalizeEmail(),
    body("permission").optional().isIn(PERMISSIONS).withMessage(`Permission must be one of: ${PERMISSIONS.join(", ")}`),
    body("expiresInDays").optional({ values: "falsy" }).isInt({ min: 1, max: 365 }),
    body("expiresAt").optional({ values: "falsy" }).isISO8601(),
  ],
  validate,
  shareController.shareWithUser
);

router.post(
  "/:id/links",
  [
    documentId,
    body("permission").optional().isIn(["view", "edit"]),
    body("password").optional({ values: "falsy" }).isString().isLength({ min: 4, max: 200 }),
    body("expiresInDays").optional({ values: "falsy" }).isInt({ min: 1, max: 365 }),
    body("maxDownloads").optional({ values: "falsy" }).isInt({ min: 1, max: 100000 }),
  ],
  validate,
  shareController.createLink
);

router.delete(
  "/:id/shares/:shareId",
  [documentId, param("shareId").matches(OBJECT_ID_PATTERN).withMessage("Not a valid share id")],
  validate,
  shareController.revoke
);

module.exports = router;
