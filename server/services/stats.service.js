"use strict";

const { db } = require("../data");
const config = require("../config/env");
const { formatBytes } = require("../utils/files");
const access = require("./access.service");
const activity = require("./activity.service");
const storage = require("./storage.service");
const documentService = require("./document.service");
const adminService = require("./admin.service");
const maintenance = require("./maintenance.service");

const DAY = 86_400_000;

/** `[{ date, count, bytes }]` for the last `days` days, zero-filled. */
function bucketByDay(records, days) {
  const buckets = new Map();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
    buckets.set(key, { date: key, count: 0, bytes: 0 });
  }

  for (const record of records) {
    const key = String(record.createdAt || "").slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.bytes += Number(record.size) || 0;
    }
  }

  return [...buckets.values()];
}

/**
 * Everything the dashboard needs in one round trip.
 *
 * The queries are independent, so they run concurrently rather than serially —
 * this endpoint is hit on every dashboard load.
 */
async function overview({ user, days = 14 }) {
  const mine = { ownerId: user.id, status: "active" };
  const since = new Date(Date.now() - (days - 1) * DAY).toISOString().slice(0, 10);

  const sharedIds = await access.documentIdsSharedWith(user);

  const [
    ownedCount,
    trashedCount,
    storageBytes,
    downloadTotal,
    viewTotal,
    categories,
    visibilities,
    recentUploads,
    topDownloaded,
    latest,
    starredCount,
    activeLinkCount,
    userShareCount,
    recentActivity,
  ] = await Promise.all([
    db.documents.count(mine),
    db.documents.count({ ownerId: user.id, status: "trashed" }),
    // Same accounting the quota check uses: every stored version, trash included.
    documentService.usageBytesFor(user.id),
    db.documents.sum("downloadCount", mine),
    db.documents.sum("viewCount", mine),
    db.documents.groupCount("category", mine),
    db.documents.groupCount("visibility", mine),
    db.documents.find({ ...mine, createdAt: { $gte: since } }, { sort: { createdAt: 1 } }),
    db.documents.find(mine, { sort: { downloadCount: -1 }, limit: 5 }),
    db.documents.find(mine, { sort: { createdAt: -1 }, limit: 5 }),
    db.documents.count({ starredBy: user.id, status: "active" }),
    db.shares.count({ createdBy: user.id, type: "link", revokedAt: null }),
    db.shares.count({ createdBy: user.id, type: "user", revokedAt: null }),
    activity.list({ actorId: user.id, query: { limit: 12 } }),
  ]);

  // Accounts created before the quota became configurable fall back to the
  // deployment default rather than reporting a nonsensical "0 B" allowance.
  const quotaBytes = await documentService.quotaBytesFor(user.id);

  const slim = (document) => ({
    id: document.id,
    title: document.title,
    category: document.category,
    size: document.size,
    sizeLabel: formatBytes(document.size),
    downloadCount: document.downloadCount || 0,
    viewCount: document.viewCount || 0,
    visibility: document.visibility,
    createdAt: document.createdAt,
  });

  return {
    totals: {
      documents: ownedCount,
      sharedWithMe: sharedIds.length,
      trashed: trashedCount,
      starred: starredCount,
      downloads: downloadTotal,
      views: viewTotal,
      activeLinks: activeLinkCount,
      peopleShares: userShareCount,
    },
    storage: {
      usedBytes: storageBytes,
      usedLabel: formatBytes(storageBytes),
      quotaBytes,
      quotaLabel: formatBytes(quotaBytes),
      usedPercent: quotaBytes ? Math.min(100, Math.round((storageBytes / quotaBytes) * 1000) / 10) : 0,
      averageBytes: ownedCount ? Math.round(storageBytes / ownedCount) : 0,
      averageLabel: formatBytes(ownedCount ? storageBytes / ownedCount : 0),
    },
    breakdown: {
      categories: Object.entries(categories)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      visibilities: Object.entries(visibilities).map(([name, count]) => ({ name, count })),
    },
    timeline: bucketByDay(recentUploads, days),
    topDownloaded: topDownloaded.filter((d) => (d.downloadCount || 0) > 0).map(slim),
    latest: latest.map(slim),
    activity: recentActivity.activities,
  };
}

/** Instance-wide numbers, admin only. */
async function systemHealth() {
  const [users, documents, trashed, shares, activities, bytes, disk] = await Promise.all([
    db.users.count({}),
    db.documents.count({ status: "active" }),
    db.documents.count({ status: "trashed" }),
    db.shares.count({ revokedAt: null }),
    db.activities.count({}),
    db.documents.sum("size", {}),
    storage.usageOnDisk(),
  ]);

  // Compared filename sets, not a subtraction. The old
  // `diskFiles - documentCount` treated every historical version as an orphan.
  const reconciliation = await adminService.reconcileStorage();

  return {
    driver: db.driver,
    users,
    documents,
    trashed,
    activeShares: shares,
    auditEntries: activities,
    trackedBytes: bytes,
    trackedLabel: formatBytes(bytes),
    disk: { ...disk, label: formatBytes(disk.bytes) },
    storageReconciliation: reconciliation,
    orphanedFiles: reconciliation.orphanedFiles,
    missingFiles: reconciliation.missingFiles,
    retention: {
      activityDays: config.retention.activityDays,
      trashDays: config.retention.trashDays,
      sweepIntervalHours: config.retention.sweepIntervalHours,
      lastRun: maintenance.lastRunSnapshot(),
    },
  };
}

module.exports = { overview, systemHealth };
