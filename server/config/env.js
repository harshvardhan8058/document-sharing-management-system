"use strict";

/**
 * Central, validated configuration.
 *
 * Everything the app needs is resolved exactly once, here, so no other module
 * has to reach into `process.env` (which is how the original code ended up
 * logging MONGODB_URI while connecting with DB_CONNECTION_STRING).
 */

const path = require("path");
const crypto = require("crypto");

require("dotenv").config();

const ROOT_DIR = path.resolve(__dirname, "..", "..");

/** Read a string, falling back when unset/blank. */
function str(key, fallback = "") {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  return trimmed === "" ? fallback : trimmed;
}

/** Read a positive integer, falling back when unset or unparseable. */
function int(key, fallback) {
  const parsed = Number.parseInt(str(key, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a comma separated list into a trimmed, de-duplicated array. */
function list(key, fallback = []) {
  const raw = str(key, "");
  if (!raw) return fallback;
  return [...new Set(raw.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

/** Resolve a possibly-relative path against the project root. */
function resolvePath(value, fallback) {
  return path.resolve(ROOT_DIR, str(value, fallback));
}

const nodeEnv = str("NODE_ENV", "development");
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

/**
 * Parse TRUST_PROXY into a value Express understands.
 *
 * This defaults to `false`, and that default matters: with `trust proxy` on,
 * Express believes whatever `X-Forwarded-For` a client sends, and the rate
 * limiter buckets by that header. A directly-exposed server with proxy trust
 * enabled therefore lets anyone mint a fresh login-attempt budget per request.
 * Only enable it when something really is in front of you.
 *
 * Accepted: false | true | <hop count> | comma-separated IPs/CIDRs/presets.
 */
function parseTrustProxy() {
  const raw = str("TRUST_PROXY", "false").toLowerCase();

  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  if (raw === "true" || raw === "on" || raw === "yes") return true;

  const hops = Number.parseInt(raw, 10);
  if (String(hops) === raw && hops >= 0) return hops;

  const list = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return list.length > 1 ? list : list[0] || false;
}

const trustProxy = parseTrustProxy();

// ---------------------------------------------------------------------------
// Database driver selection
// ---------------------------------------------------------------------------
const mongoUri = str("MONGODB_URI", str("DB_CONNECTION_STRING", ""));
const requestedDriver = str("DB_DRIVER", "auto").toLowerCase();

let driver;
if (requestedDriver === "mongo" || requestedDriver === "mongodb") {
  driver = "mongo";
} else if (requestedDriver === "local" || requestedDriver === "file") {
  driver = "local";
} else {
  // auto
  driver = mongoUri ? "mongo" : "local";
}

if (driver === "mongo" && !mongoUri) {
  throw new Error(
    "DB_DRIVER=mongo requires MONGODB_URI to be set. " +
      "Set MONGODB_URI, or use DB_DRIVER=local for the zero-config embedded store."
  );
}

// ---------------------------------------------------------------------------
// JWT secret
// ---------------------------------------------------------------------------
let jwtSecret = str("JWT_SECRET", "");
if (!jwtSecret) {
  if (isProduction) {
    throw new Error(
      "JWT_SECRET must be set when NODE_ENV=production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  // Ephemeral development secret: tokens simply expire when the server restarts.
  jwtSecret = crypto.randomBytes(48).toString("hex");
}

const config = Object.freeze({
  rootDir: ROOT_DIR,
  nodeEnv,
  isProduction,
  isTest,
  port: int("PORT", 4000),

  corsOrigin: str("CORS_ORIGIN", "*"),

  db: Object.freeze({
    driver,
    mongoUri,
    localDir: resolvePath("LOCAL_DB_DIR", "./data"),
  }),

  auth: Object.freeze({
    jwtSecret,
    jwtExpiresIn: str("JWT_EXPIRES_IN", "7d"),
    /** scrypt cost parameter (N). Must be a power of two. */
    passwordCost: int("PASSWORD_COST", 16384),
    hasExplicitSecret: Boolean(str("JWT_SECRET", "")),
  }),

  storage: Object.freeze({
    /**
     * Per-account storage allowance.
     *
     * Deliberately configuration rather than a schema default: the mongo driver
     * would apply a Mongoose default while the local driver would not, so the
     * same account would report a different quota depending on the driver.
     * Services set this explicitly at creation instead.
     */
    quotaBytes: int("STORAGE_QUOTA_GB", 2) * 1024 * 1024 * 1024,
    quotaGb: int("STORAGE_QUOTA_GB", 2),
  }),

  uploads: Object.freeze({
    dir: resolvePath("UPLOAD_DIR", "./uploads"),
    maxBytes: int("MAX_UPLOAD_MB", 25) * 1024 * 1024,
    maxMb: int("MAX_UPLOAD_MB", 25),
    allowedExtensions: list("ALLOWED_EXTENSIONS", [
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
      "txt", "md", "csv", "json", "xml", "rtf", "odt",
      "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
      "zip", "tar", "gz",
      "mp3", "mp4", "wav", "webm",
    ]),
  }),

  rateLimit: Object.freeze({
    windowMs: int("RATE_LIMIT_WINDOW_MINUTES", 15) * 60 * 1000,
    max: int("RATE_LIMIT_MAX", 600),
    authMax: int("AUTH_RATE_LIMIT_MAX", 40),
  }),

  security: Object.freeze({
    trustProxy,
    /** True when the setting blindly trusts any X-Forwarded-For header. */
    trustsAnyProxy: trustProxy === true,
  }),

  /**
   * Data retention. `0` disables a sweep entirely.
   * Without these, the audit trail and the trash both grow without bound.
   */
  retention: Object.freeze({
    activityDays: int("ACTIVITY_RETENTION_DAYS", 365),
    trashDays: int("TRASH_RETENTION_DAYS", 30),
    sweepIntervalHours: int("MAINTENANCE_INTERVAL_HOURS", 6),
  }),

  seed: Object.freeze({
    adminEmail: str("SEED_ADMIN_EMAIL", "admin@dsms.dev"),
    adminPassword: str("SEED_ADMIN_PASSWORD", "Admin@12345"),
  }),

  clientDist: path.join(ROOT_DIR, "client", "dist"),
});

module.exports = config;
