"use strict";

const crypto = require("crypto");

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Generate a 24-character hex id.
 *
 * Deliberately the same shape as a Mongo ObjectId so ids are interchangeable
 * between the mongo and local persistence drivers, and so client code never
 * has to care which driver is active.
 */
function newId() {
  return crypto.randomBytes(12).toString("hex");
}

/** True when `value` looks like a Mongo ObjectId / our own generated id. */
function isValidId(value) {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

/** A URL-safe opaque token, used for public share links. */
function newToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

module.exports = { newId, isValidId, newToken, OBJECT_ID_PATTERN };
