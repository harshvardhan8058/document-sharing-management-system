"use strict";

const express = require("express");
const { param, query } = require("express-validator");

const controller = require("../controllers/notification.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { OBJECT_ID_PATTERN } = require("../utils/ids");

const router = express.Router();

/**
 * The event stream is mounted *before* `requireAuth` on purpose: EventSource
 * cannot send an Authorization header, so it authenticates with a single-use
 * ticket instead. See services/events.service.js.
 */
router.get(
  "/stream",
  [query("ticket").isString().isLength({ min: 16, max: 128 }).withMessage("A stream ticket is required")],
  validate,
  controller.stream
);

router.use(requireAuth);

router.post("/stream/ticket", controller.streamTicket);

router.get(
  "/",
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("unreadOnly").optional().isBoolean(),
  ],
  validate,
  controller.list
);

router.get("/unread-count", controller.unreadCount);

router.post("/read-all", controller.markAllRead);
router.post(
  "/:id/read",
  [param("id").matches(OBJECT_ID_PATTERN).withMessage("Not a valid notification id")],
  validate,
  controller.markRead
);

router.delete("/read", controller.clearRead);

module.exports = router;
