"use strict";

/**
 * Populate a fresh install with an admin, a teammate, and a handful of
 * documents so the dashboard has something to show.
 *
 * Safe to re-run: existing accounts are reused and seeding is skipped if the
 * demo documents are already present.
 */

const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const config = require("../server/config/env");
const logger = require("../server/utils/logger");
const { connect, disconnect, drain } = require("../server/data");
const storage = require("../server/services/storage.service");
const authService = require("../server/services/auth.service");
const documentService = require("../server/services/document.service");
const shareService = require("../server/services/share.service");
const { db } = require("../server/data");

const SAMPLES = [
  {
    name: "q4-platform-roadmap.md",
    title: "Q4 Platform Roadmap",
    description: "Quarterly engineering priorities, owners and target dates.",
    tags: ["roadmap", "planning", "engineering"],
    visibility: "internal",
    body: `# Q4 Platform Roadmap

## Themes
1. Reliability — cut p99 latency by 40%
2. Sharing — granular per-recipient permissions
3. Observability — structured audit trail across every mutation

## Milestones
| Week | Deliverable | Owner |
| ---- | ----------- | ----- |
| 1-2  | Access-control rewrite | Platform |
| 3-5  | Public link expiry + download caps | Sharing |
| 6-8  | Version history UI | Web |
| 9-12 | Storage quota enforcement | Platform |

## Out of scope
- Real-time collaborative editing
- Desktop sync client
`,
  },
  {
    name: "security-review.md",
    title: "Security Review — Document Service",
    description: "Findings from the internal review, with remediation status.",
    tags: ["security", "audit"],
    visibility: "private",
    body: `# Security Review

## Findings

### 1. Authorization bypass (critical) — FIXED
The previous \`authenticate\` middleware evaluated \`if (req.body)\`, which is
truthy for every request. Any caller could read or delete any document.
Replaced with signed JWT verification plus a per-document permission resolver.

### 2. Path traversal in downloads (high) — FIXED
Filenames were concatenated into a hardcoded path. Stored names are now
generated server-side and every resolved path is re-checked against the upload
root.

### 3. Unbounded uploads (medium) — FIXED
No size or type limit existed. Now capped and extension allow-listed.

### 4. Orphaned files on failure (low) — FIXED
A request failing after multer wrote its file left the file behind forever.
The error handler now unlinks it.
`,
  },
  {
    name: "onboarding-checklist.txt",
    title: "New Engineer Onboarding Checklist",
    description: "Everything to get productive in the first week.",
    tags: ["onboarding", "handbook"],
    visibility: "internal",
    body: `NEW ENGINEER ONBOARDING
=======================

Day 1
  [ ] Accounts provisioned (email, repo access, CI)
  [ ] Clone the monorepo and run the local stack
  [ ] Read the architecture overview

Day 2-3
  [ ] Pair with a buddy on a starter issue
  [ ] Ship one small PR end to end
  [ ] Walk through the deployment pipeline

Week 1
  [ ] On-call shadowing session
  [ ] Meet each product area lead
  [ ] Write one improvement to this checklist
`,
  },
  {
    name: "storage-costs.csv",
    title: "Storage Cost Analysis",
    description: "Per-tier storage spend for the last two quarters.",
    tags: ["finance", "infrastructure"],
    visibility: "private",
    body: `month,tier,gigabytes,unit_cost_usd,total_usd
2026-01,hot,1420,0.023,32.66
2026-01,cold,8800,0.004,35.20
2026-02,hot,1610,0.023,37.03
2026-02,cold,9350,0.004,37.40
2026-03,hot,1780,0.023,40.94
2026-03,cold,10120,0.004,40.48
2026-04,hot,1905,0.023,43.82
2026-04,cold,11040,0.004,44.16
`,
  },
  {
    name: "api-contract.json",
    title: "API Contract — Documents v2",
    description: "Request and response shapes for the documents endpoints.",
    tags: ["api", "reference", "engineering"],
    visibility: "public",
    body: JSON.stringify(
      {
        version: "2.0.0",
        endpoints: [
          { method: "GET", path: "/api/documents", returns: "{ documents, meta, facets }" },
          { method: "POST", path: "/api/documents", body: "multipart/form-data", returns: "{ document }" },
          { method: "GET", path: "/api/documents/:id", returns: "{ document, versions, shares, activity }" },
          { method: "POST", path: "/api/documents/:id/links", returns: "{ share }" },
        ],
        errorShape: { error: { code: "STRING", message: "STRING", details: "ARRAY?" } },
      },
      null,
      2
    ),
  },
];

/** Write a sample file into the upload directory and return a multer-shaped object. */
async function stageFile(sample) {
  const ext = path.extname(sample.name).slice(1);
  const storedName = `seed-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const absolutePath = path.join(config.uploads.dir, storedName);

  await fsp.writeFile(absolutePath, sample.body, "utf8");
  const stats = await fsp.stat(absolutePath);

  return {
    filename: storedName,
    originalname: sample.name,
    size: stats.size,
    mimetype: "application/octet-stream",
    path: absolutePath,
  };
}

async function ensureUser({ firstName, lastName, email, password }) {
  const existing = await authService.findByEmail(email);
  if (existing) {
    logger.info(`User already present: ${email}`);
    return authService.publicUser(existing);
  }
  const { user } = await authService.register({ firstName, lastName, email, password });
  logger.success(`Created user ${email} (${user.role})`);
  return user;
}

async function main() {
  await connect();
  await storage.ensureDir();

  const admin = await ensureUser({
    firstName: "Ada",
    lastName: "Sterling",
    email: config.seed.adminEmail,
    password: config.seed.adminPassword,
  });

  const teammate = await ensureUser({
    firstName: "Rio",
    lastName: "Mendes",
    email: "rio@dsms.dev",
    password: "Member@12345",
  });

  const existingCount = await db.documents.count({ ownerId: admin.id });
  if (existingCount > 0) {
    logger.warn(`${admin.email} already owns ${existingCount} document(s) — skipping document seed`);
  } else {
    const created = [];
    for (const sample of SAMPLES) {
      const file = await stageFile(sample);
      const document = await documentService.create({
        user: admin,
        file,
        body: {
          title: sample.title,
          description: sample.description,
          tags: sample.tags,
          visibility: sample.visibility,
        },
      });
      created.push(document);
      logger.success(`Seeded "${document.title}" (${document.file.sizeLabel})`);
    }

    // A per-user grant and a public link, so the sharing UI is not empty.
    await shareService.shareWithUser({
      id: created[0].id,
      user: admin,
      body: { email: teammate.email, permission: "edit" },
    });
    logger.success(`Shared "${created[0].title}" with ${teammate.email} (edit)`);

    const link = await shareService.createLink({
      id: created[4].id,
      user: admin,
      body: { permission: "view", expiresInDays: 30, maxDownloads: 100 },
    });
    logger.success(`Created public link for "${created[4].title}": /s/${link.token}`);
  }

  await drain();
  await disconnect();

  logger.banner([
    "",
    "  Seed complete. Sign in with:",
    `    ${config.seed.adminEmail} / ${config.seed.adminPassword}   (admin)`,
    "    rio@dsms.dev / Member@12345                (member)",
    "",
  ]);
}

main().catch(async (err) => {
  logger.error(`Seed failed: ${err.message}`);
  console.error(err);
  await disconnect().catch(() => {});
  process.exit(1);
});
