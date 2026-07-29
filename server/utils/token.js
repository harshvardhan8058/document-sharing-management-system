"use strict";

const jwt = require("jsonwebtoken");
const config = require("../config/env");
const ApiError = require("./ApiError");

const ISSUER = "dsms";

/**
 * Sign an access token for a user.
 * @param {{id: string, email: string, role: string}} user
 */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn, issuer: ISSUER }
  );
}

/**
 * Verify and decode an access token.
 * @throws {ApiError} 401 with a specific message for expired vs. invalid tokens.
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret, { issuer: ISSUER });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized("Session expired — please sign in again", {
        code: "TOKEN_EXPIRED",
      });
    }
    throw ApiError.unauthorized("Invalid authentication token", { code: "TOKEN_INVALID" });
  }
}

/** Extract a bearer token from the Authorization header, or null. */
function readBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return value.trim() || null;
}

module.exports = { signAccessToken, verifyAccessToken, readBearerToken };
