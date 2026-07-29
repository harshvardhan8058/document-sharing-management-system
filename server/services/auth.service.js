"use strict";

const { db } = require("../data");
const config = require("../config/env");
const ApiError = require("../utils/ApiError");
const { hashPassword, verifyPassword, scorePassword } = require("../utils/password");
const { signAccessToken } = require("../utils/token");
const activityService = require("./activity.service");

const ACCENTS = ["#5b8cff", "#22d3ee", "#a855f7", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#818cf8"];

/** Deterministic accent colour so a user's avatar is stable across sessions. */
function accentFor(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) hash = (hash * 31 + email.charCodeAt(i)) % 997;
  return ACCENTS[hash % ACCENTS.length];
}

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

/**
 * Strip secrets and add derived fields. Never return a raw user record.
 * `tokenVersion` is internal bookkeeping and is not part of the API surface.
 */
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, tokenVersion, ...rest } = user;
  return {
    ...rest,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    initials: `${(user.firstName || "?")[0]}${(user.lastName || "")[0] || ""}`.toUpperCase(),
  };
}

/** Mint a token from a raw stored record, so the token version always matches. */
function tokenFor(record) {
  return signAccessToken({
    id: record.id,
    email: record.email,
    role: record.role,
    tokenVersion: Number(record.tokenVersion) || 0,
  });
}

async function findByEmail(email) {
  return db.users.findOne({ email: normalizeEmail(email) });
}

/**
 * Create an account.
 *
 * The very first account becomes the admin — this bootstraps a fresh install
 * without shipping default credentials.
 */
async function register({ firstName, lastName, email, password }, req) {
  const normalized = normalizeEmail(email);

  if (await findByEmail(normalized)) {
    throw ApiError.conflict("An account with this email already exists", {
      code: "EMAIL_TAKEN",
      details: [{ field: "email", message: "Already registered" }],
    });
  }

  const isFirstUser = (await db.users.count({})) === 0;

  const created = await db.users.create({
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    email: normalized,
    passwordHash: await hashPassword(password),
    role: isFirstUser ? "admin" : "member",
    accentColor: accentFor(normalized),
    // Every field is set explicitly so a record looks identical whichever
    // driver wrote it — the local store has no schema to fall back on.
    storageQuotaBytes: config.storage.quotaBytes,
    tokenVersion: 0,
    isActive: true,
    lastLoginAt: new Date().toISOString(),
  });

  const user = publicUser(created);
  await activityService.record("user.registered", { req, actor: user });

  // Documents shared with this address before the account existed are matched by
  // email at access-resolution time; stamping the id on them now means the
  // recipient shows up correctly in the owner's share list straight away.
  const pendingShares = await db.shares.updateMany(
    { type: "user", email: normalized, userId: null, revokedAt: null },
    { userId: created.id }
  );

  return {
    user,
    token: tokenFor(created),
    passwordStrength: scorePassword(password),
    pendingShares,
  };
}

/**
 * Exchange credentials for a token.
 *
 * Unknown email and wrong password return the *same* message so the endpoint
 * cannot be used to enumerate registered addresses.
 */
async function login({ email, password }, req) {
  const record = await findByEmail(email);
  const invalid = ApiError.unauthorized("Email or password is incorrect", { code: "BAD_CREDENTIALS" });

  if (!record) {
    // Spend comparable time on the miss path to blunt timing analysis.
    await verifyPassword(password, "scrypt$16384$00$00");
    throw invalid;
  }
  if (!(await verifyPassword(password, record.passwordHash))) throw invalid;
  if (record.isActive === false) {
    throw ApiError.forbidden("This account has been deactivated", { code: "ACCOUNT_DISABLED" });
  }

  const updated = await db.users.updateById(record.id, { lastLoginAt: new Date().toISOString() });
  const user = publicUser(updated || record);

  await activityService.record("user.login", { req, actor: user });

  return { user, token: tokenFor(updated || record) };
}

async function getById(userId) {
  const user = await db.users.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  return publicUser(user);
}

async function updateProfile(userId, { firstName, lastName, accentColor }, req) {
  const patch = {};
  if (firstName !== undefined) patch.firstName = String(firstName).trim();
  if (lastName !== undefined) patch.lastName = String(lastName).trim();
  if (accentColor !== undefined) patch.accentColor = accentColor;

  if (!Object.keys(patch).length) throw ApiError.badRequest("Nothing to update");

  const updated = await db.users.updateById(userId, patch);
  if (!updated) throw ApiError.notFound("User not found");

  const user = publicUser(updated);
  await activityService.record("user.profile_updated", { req, actor: user });
  return user;
}

async function changePassword(userId, { currentPassword, newPassword }, req) {
  const record = await db.users.findById(userId);
  if (!record) throw ApiError.notFound("User not found");

  if (!(await verifyPassword(currentPassword, record.passwordHash))) {
    throw ApiError.badRequest("Your current password is incorrect", {
      code: "BAD_CREDENTIALS",
      details: [{ field: "currentPassword", message: "Incorrect" }],
    });
  }
  if (await verifyPassword(newPassword, record.passwordHash)) {
    throw ApiError.badRequest("Choose a password you have not used before", {
      code: "PASSWORD_REUSED",
      details: [{ field: "newPassword", message: "Must differ from the current password" }],
    });
  }

  // Rotating the password ends every other session. The caller gets a freshly
  // signed token back so the browser they are sitting at stays signed in.
  const updated = await db.users.updateById(userId, {
    passwordHash: await hashPassword(newPassword),
    tokenVersion: (Number(record.tokenVersion) || 0) + 1,
  });

  const user = publicUser(updated);
  await activityService.record("user.password_changed", {
    req,
    actor: user,
    detail: "Other sessions were signed out",
  });

  return { changed: true, strength: scorePassword(newPassword), token: tokenFor(updated) };
}

/**
 * Invalidate every token issued to this account, including the caller's.
 * Used by "sign out everywhere" after a suspected credential leak.
 */
async function revokeAllSessions(userId, req) {
  const record = await db.users.findById(userId);
  if (!record) throw ApiError.notFound("User not found");

  const updated = await db.users.updateById(userId, {
    tokenVersion: (Number(record.tokenVersion) || 0) + 1,
  });

  const user = publicUser(updated);
  await activityService.record("user.sessions_revoked", { req, actor: user });

  return { revoked: true, tokenVersion: updated.tokenVersion };
}

/**
 * Directory listing used by the share dialog.
 * Returns only what the UI needs to render a person chip.
 */
async function directory({ search = "", excludeUserId = null, limit = 20 } = {}) {
  const filter = { isActive: { $ne: false } };
  if (search) {
    const term = String(search).trim();
    filter.$or = [
      { email: { $regex: term, $options: "i" } },
      { firstName: { $regex: term, $options: "i" } },
      { lastName: { $regex: term, $options: "i" } },
    ];
  }

  const users = await db.users.find(filter, { sort: { firstName: 1 }, limit: limit + 1 });

  return users
    .filter((user) => user.id !== excludeUserId)
    .slice(0, limit)
    .map((user) => {
      const pub = publicUser(user);
      return {
        id: pub.id,
        email: pub.email,
        fullName: pub.fullName,
        initials: pub.initials,
        accentColor: pub.accentColor,
        role: pub.role,
      };
    });
}

module.exports = {
  register,
  login,
  getById,
  updateProfile,
  changePassword,
  revokeAllSessions,
  directory,
  publicUser,
  findByEmail,
  normalizeEmail,
  ACCENTS,
};
