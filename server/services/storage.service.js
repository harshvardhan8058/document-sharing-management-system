"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const config = require("../config/env");
const logger = require("../utils/logger");

const UPLOAD_DIR = config.uploads.dir;

/**
 * Resolve a stored filename to an absolute path inside the upload directory.
 *
 * `path.basename` strips any directory component, and the result is re-checked
 * against the upload root. Together these make `../../etc/passwd` — or an id
 * tampered with in the database — resolve to something harmless rather than
 * escaping the sandbox.
 */
function pathFor(storedName) {
  const safeName = path.basename(String(storedName || ""));
  const resolved = path.resolve(UPLOAD_DIR, safeName);

  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    throw new Error(`Refusing to access "${storedName}" outside the upload directory`);
  }
  return resolved;
}

async function ensureDir() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

/** sha256 of a file, streamed so large files never sit in memory. */
function checksumOf(absolutePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absolutePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function exists(storedName) {
  try {
    await fsp.access(pathFor(storedName), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function statOf(storedName) {
  try {
    return await fsp.stat(pathFor(storedName));
  } catch {
    return null;
  }
}

/**
 * Delete a stored file. Never throws: a missing file is the desired end state,
 * and a failed cleanup must not fail the user's request.
 */
async function removeFile(storedName) {
  if (!storedName) return false;
  try {
    await fsp.unlink(pathFor(storedName));
    return true;
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Could not delete upload "${storedName}": ${err.message}`);
    }
    return false;
  }
}

/** Delete several stored files, tolerating individual failures. */
async function removeFiles(storedNames = []) {
  const results = await Promise.all(storedNames.filter(Boolean).map(removeFile));
  return results.filter(Boolean).length;
}

/** Read a text file with a hard cap, used for inline text previews. */
async function readTextPreview(storedName, maxBytes = 128 * 1024) {
  const handle = await fsp.open(pathFor(storedName), "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const stats = await handle.stat();
    return {
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: stats.size > bytesRead,
      size: stats.size,
    };
  } finally {
    await handle.close();
  }
}

/** Total bytes currently held in the upload directory. */
async function usageOnDisk() {
  try {
    const names = await fsp.readdir(UPLOAD_DIR);
    const sizes = await Promise.all(
      names.map(async (name) => {
        const stats = await fsp.stat(path.join(UPLOAD_DIR, name)).catch(() => null);
        return stats && stats.isFile() ? stats.size : 0;
      })
    );
    return { files: names.length, bytes: sizes.reduce((a, b) => a + b, 0) };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

module.exports = {
  UPLOAD_DIR,
  pathFor,
  ensureDir,
  checksumOf,
  exists,
  statOf,
  removeFile,
  removeFiles,
  readTextPreview,
  usageOnDisk,
};
