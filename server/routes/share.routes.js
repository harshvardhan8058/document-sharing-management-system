"use strict";

const express = require("express");
const { param } = require("express-validator");

const controller = require("../controllers/share.controller");
const validate = require("../middleware/validate");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * Public share-link endpoints.
 *
 * `optionalAuth` rather than `requireAuth`: the whole point of a link is that a
 * recipient without an account can use it, but when the visitor *is* signed in
 * we still want their name on the audit entry.
 */
router.use(optionalAuth);

const shareToken = param("token")
  .isString()
  .isLength({ min: 16, max: 128 })
  .matches(/^[A-Za-z0-9_-]+$/)
  .withMessage("Not a valid share token");

router.get("/:token", [shareToken], validate, controller.viewByToken);
router.post("/:token/unlock", [shareToken], validate, controller.unlock);
router.get("/:token/download", [shareToken], validate, controller.downloadByToken);
router.get("/:token/preview", [shareToken], validate, controller.previewByToken);

module.exports = router;
