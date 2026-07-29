"use strict";

/**
 * Scheduled housekeeping.
 *
 * Two things grew without bound before this existed: the audit trail (nothing
 * ever removed an entry) and the trash (a soft-deleted document kept its files
 * on disk and its bytes against the owner's quota forever).
 *
 * Both sweeps are opt-out rather than opt-in — retention you have to remember to
 * turn on is retention nobody has.
 */

const { db } = require("../data");
const config = require("../config/env");
const logger = require("../utils/logger");
const { formatBytes } = require("../utils/files");
const storage = require("./storage.service");

const DAY = 86_400_000;

const cutoffFor = (days) => new Date(Date.now() - days * DAY).toISOString();

/** Last sweep result, surfaced on the admin health endpoint. */
let lastRun = null;

/** Drop audit entries older than the retention window. */
async function pruneActivity(days = config.retention.activityDays) {
  if (!days || days <= 0) return { skipped: true, removed: 0 };

  const removed = await db.activities.deleteMany({ createdAt: { $lt: cutoffFor(days) } });
  return { skipped: false, removed, olderThanDays: days };
}

/**
 * Permanently delete documents that have sat in the trash past the window.
 *
 * Deliberately reuses the same order as a manual permanent delete — files,
 * then shares, then the record — so a crash mid-sweep leaves no share pointing
 * at a document that is gone.
 */
async function purgeTrash(days = config.retention.trashDays) {
  if (!days || days <= 0) return { skipped: true, documents: 0, files: 0, bytes: 0 };

  const expired = await db.documents.find({
    status: "trashed",
    trashedAt: { $lt: cutoffFor(days) },
  });

  let files = 0;
  let bytes = 0;

  for (const document of expired) {
    const names = new Set([
      document.storedName,
      ...(document.versions || []).map((version) => version.storedName),
    ]);

    bytes += (document.versions || []).reduce((sum, v) => sum + (Number(v.size) || 0), 0) || Number(document.size) || 0;
    files += await storage.removeFiles([...names]);

    await db.shares.deleteMany({ documentId: document.id });
    await db.documents.deleteById(document.id);

    logger.info(`Purged "${document.title}" from trash (older than ${days} days)`);
  }

  return { skipped: false, documents: expired.length, files, bytes, olderThanDays: days };
}

/** Run every sweep once. Never throws — housekeeping must not take the app down. */
async function sweep({ reason = "scheduled" } = {}) {
  const startedAt = Date.now();

  try {
    const [activity, trash] = [await pruneActivity(), await purgeTrash()];

    lastRun = {
      at: new Date().toISOString(),
      reason,
      durationMs: Date.now() - startedAt,
      activity,
      trash,
    };

    if (activity.removed || trash.documents) {
      logger.info(
        `Maintenance: removed ${activity.removed} audit entr${activity.removed === 1 ? "y" : "ies"}, ` +
          `purged ${trash.documents} trashed document(s) freeing ${formatBytes(trash.bytes)}`
      );
    }

    return lastRun;
  } catch (err) {
    logger.error(`Maintenance sweep failed: ${err.message}`);
    lastRun = { at: new Date().toISOString(), reason, error: err.message };
    return lastRun;
  }
}

/**
 * Start the recurring sweep and run one immediately.
 *
 * The timer is `unref`'d so it never holds the process open during shutdown.
 * @returns {() => void} stop function
 */
function schedule() {
  const hours = config.retention.sweepIntervalHours;

  // Kick one off at boot so a long-stopped instance catches up on restart.
  sweep({ reason: "startup" });

  if (!hours || hours <= 0) {
    logger.info("Maintenance sweeps disabled (MAINTENANCE_INTERVAL_HOURS=0)");
    return () => {};
  }

  const timer = setInterval(() => sweep({ reason: "scheduled" }), hours * 3600 * 1000);
  timer.unref();

  logger.info(
    `Maintenance every ${hours}h — audit retention ${config.retention.activityDays || "off"} day(s), ` +
      `trash retention ${config.retention.trashDays || "off"} day(s)`
  );

  return () => clearInterval(timer);
}

module.exports = { sweep, schedule, pruneActivity, purgeTrash, lastRunSnapshot: () => lastRun };
