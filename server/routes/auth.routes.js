"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { body, query } = require("express-validator");

const config = require("../config/env");
const controller = require("../controllers/auth.controller");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { ACCENTS } = require("../services/auth.service");

const router = express.Router();

/**
 * Credential endpoints get their own, much tighter budget than the rest of the
 * API — the global limiter is far too generous to slow down password guessing.
 */
const credentialLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { trustProxy: false },
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts — try again later" } },
});

const passwordRules = (field, label = "Password") =>
  body(field)
    .isString()
    .isLength({ min: 8, max: 200 })
    .withMessage(`${label} must be at least 8 characters`)
    .matches(/[a-zA-Z]/)
    .withMessage(`${label} must contain a letter`)
    .matches(/\d/)
    .withMessage(`${label} must contain a number`);

router.post(
  "/register",
  credentialLimiter,
  [
    body("firstName").isString().trim().isLength({ min: 1, max: 60 }).withMessage("First name is required"),
    body("lastName").isString().trim().isLength({ min: 1, max: 60 }).withMessage("Last name is required"),
    body("email").isEmail().withMessage("Enter a valid email address").normalizeEmail(),
    passwordRules("password"),
  ],
  validate,
  controller.register
);

router.post(
  "/login",
  credentialLimiter,
  [
    body("email").isEmail().withMessage("Enter a valid email address").normalizeEmail(),
    body("password").isString().notEmpty().withMessage("Password is required"),
  ],
  validate,
  controller.login
);

router.post(
  "/password-strength",
  [body("password").isString().withMessage("password must be a string")],
  validate,
  controller.checkPasswordStrength
);

router.get("/me", requireAuth, controller.me);

router.patch(
  "/me",
  requireAuth,
  [
    body("firstName").optional().isString().trim().isLength({ min: 1, max: 60 }),
    body("lastName").optional().isString().trim().isLength({ min: 1, max: 60 }),
    body("accentColor").optional().isIn(ACCENTS).withMessage("Pick one of the available accent colours"),
  ],
  validate,
  controller.updateProfile
);

router.post(
  "/change-password",
  requireAuth,
  credentialLimiter,
  [body("currentPassword").isString().notEmpty().withMessage("Current password is required"), passwordRules("newPassword", "New password")],
  validate,
  controller.changePassword
);

router.get(
  "/directory",
  requireAuth,
  [query("search").optional().isString().trim(), query("limit").optional().isInt({ min: 1, max: 50 })],
  validate,
  controller.directory
);

router.post("/logout-all", requireAuth, controller.revokeSessions);

router.get("/me/activity", requireAuth, controller.myActivity);

module.exports = router;
