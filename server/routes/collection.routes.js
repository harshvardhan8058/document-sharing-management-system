"use strict";

const express = require("express");
const { body, param } = require("express-validator");

const controller = require("../controllers/collection.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { OBJECT_ID_PATTERN } = require("../utils/ids");
const { ICONS } = require("../services/collection.service");

const router = express.Router();

router.use(requireAuth);

const collectionId = param("id").matches(OBJECT_ID_PATTERN).withMessage("Not a valid collection id");

const documentIds = body("documentIds")
  .isArray({ min: 1, max: 200 })
  .withMessage("documentIds must be an array of 1-200 ids")
  .bail()
  .custom((ids) => ids.every((id) => OBJECT_ID_PATTERN.test(String(id))))
  .withMessage("documentIds contains an invalid id");

const details = [
  body("name").optional().isString().trim().isLength({ min: 1, max: 60 }),
  body("description").optional().isString().trim().isLength({ max: 300 }),
  body("color").optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage("Colour must be a hex value"),
  body("icon").optional().isIn(ICONS),
  body("position").optional().isInt({ min: 0, max: 999 }),
];

router.get("/", controller.list);

router.post(
  "/",
  [body("name").isString().trim().isLength({ min: 1, max: 60 }).withMessage("A name is required"), ...details],
  validate,
  controller.create
);

router.patch("/:id", [collectionId, ...details], validate, controller.update);

/** Deleting a collection never deletes its documents — they become unfiled. */
router.delete("/:id", [collectionId], validate, controller.remove);

router.post("/:id/documents", [collectionId, documentIds], validate, controller.assign);
router.post("/unfile", [documentIds], validate, controller.unfile);

module.exports = router;
