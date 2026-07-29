"use strict";

const express = require("express");
const { query } = require("express-validator");

const controller = require("../controllers/stats.controller");
const validate = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/overview", [query("days").optional().isInt({ min: 7, max: 90 })], validate, controller.overview);

router.get("/activity", requireRole("admin"), controller.activityFeed);
router.get("/system", requireRole("admin"), controller.system);

module.exports = router;
