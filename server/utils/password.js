"use strict";

const crypto = require("crypto");
const { promisify } = require("util");
const config = require("../config/env");

const scrypt = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Password hashing built on Node's native scrypt.
 *
 * scrypt is memory-hard and ships with Node, so there is no native-addon build
 * step (a common reason bcrypt installs fail in CI/containers).
 *
 * Stored format: `scrypt$<N>$<saltHex>$<hashHex>` — self-describing, so the
 * cost parameter can be raised later without invalidating existing hashes.
 */
async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new TypeError("hashPassword expects a non-empty string");
  }
  const cost = config.auth.passwordCost;
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(plain, salt, KEY_LENGTH, { N: cost, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${cost}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verify a password against a stored hash.
 * Always returns a boolean — malformed hashes verify as `false` rather than throwing.
 */
async function verifyPassword(plain, stored) {
  if (typeof plain !== "string" || typeof stored !== "string") return false;

  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const cost = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(cost) || cost <= 0) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], "hex");
    expected = Buffer.from(parts[3], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual;
  try {
    actual = await scrypt(plain, salt, expected.length, { N: cost, maxmem: 256 * 1024 * 1024 });
  } catch {
    return false;
  }

  // Constant-time comparison: lengths already match by construction.
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Rough password strength signal, surfaced to the UI as a hint.
 * @returns {{score: number, label: string}} score is 0-4
 */
function scorePassword(plain = "") {
  let score = 0;
  if (plain.length >= 8) score += 1;
  if (plain.length >= 12) score += 1;
  if (/[a-z]/.test(plain) && /[A-Z]/.test(plain)) score += 1;
  if (/\d/.test(plain) && /[^A-Za-z0-9]/.test(plain)) score += 1;
  const labels = ["very weak", "weak", "fair", "strong", "excellent"];
  return { score, label: labels[score] };
}

module.exports = { hashPassword, verifyPassword, scorePassword };
