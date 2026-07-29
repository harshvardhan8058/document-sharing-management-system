"use strict";

const { db } = require("../data");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { verifyAccessToken, readBearerToken } = require("../utils/token");

/**
 * Resolve the bearer token to a live user record.
 *
 * The token is only half the check: the account is re-read on every request so
 * a deactivated or deleted user cannot keep using an unexpired token.
 */
async function resolveUser(req) {
  const token = readBearerToken(req);
  if (!token) return null;

  const payload = verifyAccessToken(token); // throws ApiError(401) when invalid
  const user = await db.users.findById(payload.sub);

  if (!user) throw ApiError.unauthorized("Account no longer exists", { code: "ACCOUNT_MISSING" });
  if (user.isActive === false) {
    throw ApiError.forbidden("This account has been deactivated", { code: "ACCOUNT_DISABLED" });
  }

  // A token minted before the account's version was bumped is dead, even though
  // its signature and expiry are still perfectly valid.
  if ((Number(payload.tv) || 0) !== (Number(user.tokenVersion) || 0)) {
    throw ApiError.unauthorized("This session has been signed out", { code: "TOKEN_REVOKED" });
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    tokenVersion: Number(user.tokenVersion) || 0,
  };
}

/** Require a valid token. Rejects with 401 otherwise. */
const requireAuth = asyncHandler(async (req, res, next) => {
  const user = await resolveUser(req);
  if (!user) {
    throw ApiError.unauthorized("Sign in to continue", { code: "TOKEN_MISSING" });
  }
  req.user = user;
  next();
});

/**
 * Attach `req.user` when a valid token is present, but allow anonymous access.
 * Used by public share-link routes, which behave differently for signed-in users.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    req.user = await resolveUser(req);
  } catch {
    // A bad token on an optional route is treated as "not signed in" rather
    // than an error, so an expired session can still open a public link.
    req.user = null;
  }
  next();
});

/** Require one of the given roles. Must run after requireAuth. */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) return next(ApiError.unauthorized("Sign in to continue"));
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`This action requires the ${roles.join(" or ")} role`, {
          code: "INSUFFICIENT_ROLE",
        })
      );
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole };
