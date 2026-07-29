"use strict";

const express = require("express");

const config = require("../config/env");
const { db } = require("../data");
const { formatBytes } = require("../utils/files");

const authRoutes = require("./auth.routes");
const documentRoutes = require("./document.routes");
const shareRoutes = require("./share.routes");
const statsRoutes = require("./stats.routes");
const adminRoutes = require("./admin.routes");

const router = express.Router();

/** Liveness/readiness probe. Cheap on purpose — no database round trip. */
router.get("/health", (req, res) => {
  res.json({
    status: db.ready ? "ok" : "starting",
    driver: db.driver,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/** Self-describing index so the API is explorable without external docs. */
router.get("/", (req, res) => {
  res.json({
    name: "Document Sharing & Management System API",
    version: require("../../package.json").version,
    driver: db.driver,
    limits: {
      maxUploadBytes: config.uploads.maxBytes,
      maxUploadLabel: formatBytes(config.uploads.maxBytes),
      allowedExtensions: config.uploads.allowedExtensions,
    },
    endpoints: {
      auth: {
        "POST /api/auth/register": "Create an account (first account becomes admin)",
        "POST /api/auth/login": "Exchange credentials for a bearer token",
        "GET /api/auth/me": "Current user",
        "PATCH /api/auth/me": "Update profile",
        "POST /api/auth/change-password": "Rotate password (ends other sessions, returns a fresh token)",
        "POST /api/auth/logout-all": "Invalidate every token for this account",
        "GET /api/auth/directory": "People picker for sharing",
        "GET /api/auth/me/activity": "Your audit trail",
      },
      documents: {
        "GET /api/documents": "List (scope, search, category, tag, visibility, sort, page, limit)",
        "POST /api/documents": "Upload (multipart: file, title, description, tags, visibility)",
        "GET /api/documents/tags": "Distinct tags you can see",
        "GET /api/documents/:id": "Detail with versions, shares and activity",
        "PATCH /api/documents/:id": "Update metadata",
        "POST /api/documents/:id/versions": "Upload a new version",
        "GET /api/documents/:id/download": "Download (optional ?version=)",
        "GET /api/documents/:id/preview": "Inline preview",
        "GET /api/documents/:id/preview/text": "Text preview payload",
        "PUT|DELETE /api/documents/:id/star": "Star / unstar",
        "POST /api/documents/:id/trash": "Move to trash",
        "POST /api/documents/:id/restore": "Restore from trash",
        "DELETE /api/documents/:id?permanent=true": "Delete permanently",
        "DELETE /api/documents/trash/empty": "Empty your trash",
      },
      sharing: {
        "GET /api/documents/:id/shares": "List grants",
        "POST /api/documents/:id/shares": "Grant access to an email",
        "POST /api/documents/:id/links": "Create a public link",
        "DELETE /api/documents/:id/shares/:shareId": "Revoke a grant or link",
        "GET /api/share/:token": "Public: view a shared document",
        "POST /api/share/:token/unlock": "Public: unlock a password-protected link",
        "GET /api/share/:token/download": "Public: download",
        "GET /api/share/:token/preview": "Public: inline preview",
      },
      insights: {
        "GET /api/stats/overview": "Dashboard metrics",
        "GET /api/stats/activity": "Instance-wide audit feed (admin)",
        "GET /api/stats/system": "Instance health (admin)",
      },
      administration: {
        "GET /api/admin/users": "List accounts with storage footprint (admin)",
        "PATCH /api/admin/users/:id": "Change role, active state or quota (admin)",
        "GET /api/admin/storage": "Reconcile database records against files on disk (admin)",
        "POST /api/admin/storage/purge-orphans": "Delete unreferenced files (admin)",
        "POST /api/admin/maintenance/run": "Run the retention sweeps now (admin)",
      },
    },
  });
});

router.use("/auth", authRoutes);
router.use("/documents", documentRoutes);
router.use("/share", shareRoutes);
router.use("/stats", statsRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
