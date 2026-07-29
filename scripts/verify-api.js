"use strict";

/**
 * End-to-end API verification.
 *
 * Boots the real server in-process against a throwaway database and upload
 * directory, then exercises every endpoint over real HTTP — including the
 * failure paths that the original code got wrong (missing auth, wrong
 * permissions, oversized uploads, path traversal, expired links).
 *
 * Exits non-zero on the first failure, so it doubles as a CI gate.
 *
 *   npm run verify
 */

// Isolate this run *before* anything reads configuration. dotenv does not
// override values that are already set, so these win over .env.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.PORT = process.env.PORT || "4599";
process.env.DB_DRIVER = process.env.DB_DRIVER || "local";
process.env.LOCAL_DB_DIR = "./.verify/data";
process.env.UPLOAD_DIR = "./.verify/uploads";
process.env.JWT_SECRET = "verification-only-secret-do-not-use-in-production";
process.env.MAX_UPLOAD_MB = "2";
process.env.RATE_LIMIT_MAX = "100000";
process.env.AUTH_RATE_LIMIT_MAX = "100000";
// Retention sweeps are exercised explicitly; a timer firing mid-run would make
// results depend on how long the suite took.
process.env.MAINTENANCE_INTERVAL_HOURS = "0";
process.env.ACTIVITY_RETENTION_DAYS = "0";
process.env.TRASH_RETENTION_DAYS = "0";

/**
 * Against MongoDB, redirect to a throwaway database that is dropped afterwards.
 * Without this, pointing the suite at a real cluster would write test accounts
 * into whatever database the connection string names.
 *
 *   DB_DRIVER=mongo MONGODB_URI=mongodb://127.0.0.1:27017 npm run verify
 */
const MONGO_SCRATCH_DB = `dsms_verify_${process.pid}`;

if (process.env.DB_DRIVER === "mongo") {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const parsed = new URL(uri);
  parsed.pathname = `/${MONGO_SCRATCH_DB}`;
  process.env.MONGODB_URI = parsed.toString();
}

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SANDBOX = path.join(ROOT, ".verify");

// Start from a clean slate so results never depend on a previous run.
fs.rmSync(SANDBOX, { recursive: true, force: true });

const { main } = require("../server/index");
const { disconnect, drain } = require("../server/data");
const storage = require("../server/services/storage.service");

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------

const results = [];
let currentGroup = "";

const c = {
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
  cyan: (s) => `\u001b[36m${s}\u001b[0m`,
};

function group(name) {
  currentGroup = name;
  console.log(`\n${c.bold(c.cyan(name))}`);
}

async function check(description, fn) {
  try {
    await fn();
    results.push({ group: currentGroup, description, ok: true });
    console.log(`  ${c.green("PASS")}  ${description}`);
  } catch (err) {
    results.push({ group: currentGroup, description, ok: false, error: err });
    console.log(`  ${c.red("FAIL")}  ${description}`);
    console.log(c.dim(`        ${err.message.split("\n").join("\n        ")}`));
  }
}

/** Perform a request and return `{ status, body, headers, raw }`. */
async function call(method, url, { token, body, headers = {}, raw = false } = {}) {
  const options = { method, headers: { ...headers } };
  if (token) options.headers.Authorization = `Bearer ${token}`;

  if (body instanceof FormData) {
    options.body = body; // fetch sets the multipart boundary itself
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${url}`, options);

  if (raw) {
    return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function expectStatus(response, expected, context = "") {
  assert.strictEqual(
    response.status,
    expected,
    `${context}expected HTTP ${expected}, got ${response.status}\n  body: ${JSON.stringify(response.body)}`
  );
}

function expectCode(response, code) {
  assert.strictEqual(
    response.body?.error?.code,
    code,
    `expected error code ${code}, got ${JSON.stringify(response.body)}`
  );
}

/** Build a multipart body for an upload. */
function uploadForm({ filename, content, ...fields }) {
  const form = new FormData();
  form.append("file", new Blob([content]), filename);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    form.append(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return form;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

const stamp = Date.now().toString(36);
const owner = {
  firstName: "Vera",
  lastName: "Okonkwo",
  email: `owner-${stamp}@example.com`,
  password: "Corridor7Lantern",
};
const collaborator = {
  firstName: "Iwan",
  lastName: "Brandt",
  email: `collab-${stamp}@example.com`,
  password: "Meridian4Cascade",
};

const state = {};

async function run() {
  // -------------------------------------------------------------------------
  group("Service health & discovery");

  await check("GET /api/health reports the active driver", async () => {
    const res = await call("GET", "/api/health");
    expectStatus(res, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.driver, process.env.DB_DRIVER);
  });

  await check("GET /api returns a self-describing endpoint index", async () => {
    const res = await call("GET", "/api");
    expectStatus(res, 200);
    assert.ok(res.body.endpoints.documents, "documents section missing");
    assert.ok(Array.isArray(res.body.limits.allowedExtensions));
  });

  await check("unknown /api path returns a JSON 404, not HTML", async () => {
    const res = await call("GET", "/api/nope");
    expectStatus(res, 404);
    expectCode(res, "ROUTE_NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  group("Authentication");

  await check("first account is created and becomes admin", async () => {
    const res = await call("POST", "/api/auth/register", { body: owner });
    expectStatus(res, 201);
    assert.ok(res.body.token, "no token returned");
    assert.strictEqual(res.body.user.email, owner.email);
    assert.strictEqual(res.body.user.role, "admin", "first user should be admin");
    assert.strictEqual(res.body.user.passwordHash, undefined, "password hash leaked in response");
    state.ownerToken = res.body.token;
    state.owner = res.body.user;
  });

  await check("second account is created as a member", async () => {
    const res = await call("POST", "/api/auth/register", { body: collaborator });
    expectStatus(res, 201);
    assert.strictEqual(res.body.user.role, "member");
    state.collabToken = res.body.token;
    state.collab = res.body.user;
  });

  await check("duplicate email is rejected with 409", async () => {
    const res = await call("POST", "/api/auth/register", { body: owner });
    expectStatus(res, 409);
    expectCode(res, "EMAIL_TAKEN");
  });

  await check("weak password is rejected with field-level detail", async () => {
    const res = await call("POST", "/api/auth/register", {
      body: { firstName: "A", lastName: "B", email: `weak-${stamp}@example.com`, password: "short" },
    });
    expectStatus(res, 422);
    expectCode(res, "VALIDATION_FAILED");
    assert.ok(
      res.body.error.details.some((d) => d.field === "password"),
      "expected a password detail entry"
    );
  });

  await check("login succeeds with correct credentials", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { email: owner.email, password: owner.password },
    });
    expectStatus(res, 200);
    assert.ok(res.body.token);
    state.ownerToken = res.body.token;
  });

  await check("login fails with a wrong password and does not reveal why", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { email: owner.email, password: "definitely-wrong" },
    });
    expectStatus(res, 401);
    expectCode(res, "BAD_CREDENTIALS");
    assert.strictEqual(res.body.error.message, "Email or password is incorrect");
  });

  await check("login for an unknown email returns the identical message", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { email: `ghost-${stamp}@example.com`, password: "whatever123" },
    });
    expectStatus(res, 401);
    assert.strictEqual(res.body.error.message, "Email or password is incorrect");
  });

  await check("GET /api/auth/me returns the signed-in user", async () => {
    const res = await call("GET", "/api/auth/me", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.user.email, owner.email);
    assert.strictEqual(res.body.user.fullName, "Vera Okonkwo");
  });

  await check("a garbage token is rejected", async () => {
    const res = await call("GET", "/api/auth/me", { token: "not.a.jwt" });
    expectStatus(res, 401);
    expectCode(res, "TOKEN_INVALID");
  });

  await check("profile updates persist", async () => {
    const res = await call("PATCH", "/api/auth/me", {
      token: state.ownerToken,
      body: { firstName: "Verity" },
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.user.firstName, "Verity");
  });

  await check("password change requires the current password", async () => {
    const res = await call("POST", "/api/auth/change-password", {
      token: state.ownerToken,
      body: { currentPassword: "wrong-one", newPassword: "Freshwater9Anchor" },
    });
    expectStatus(res, 400);
    expectCode(res, "BAD_CREDENTIALS");
  });

  await check("directory search finds the collaborator", async () => {
    const res = await call("GET", `/api/auth/directory?search=${encodeURIComponent(collaborator.email)}`, {
      token: state.ownerToken,
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.users.length, 1);
    assert.strictEqual(res.body.users[0].email, collaborator.email);
  });

  // -------------------------------------------------------------------------
  group("Authorization gates");

  await check("listing documents without a token is refused", async () => {
    const res = await call("GET", "/api/documents");
    expectStatus(res, 401);
    expectCode(res, "TOKEN_MISSING");
  });

  await check("member cannot reach the admin-only system endpoint", async () => {
    const res = await call("GET", "/api/stats/system", { token: state.collabToken });
    expectStatus(res, 403);
    expectCode(res, "INSUFFICIENT_ROLE");
  });

  await check("admin can reach the admin-only system endpoint", async () => {
    const res = await call("GET", "/api/stats/system", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.driver, process.env.DB_DRIVER);
  });

  // -------------------------------------------------------------------------
  group("Upload & retrieval");

  const originalContent = "# Migration Plan\n\nPhase 1: dual write\nPhase 2: backfill\nPhase 3: cut over\n";

  await check("uploading a document returns 201 with full metadata", async () => {
    const res = await call("POST", "/api/documents", {
      token: state.ownerToken,
      body: uploadForm({
        filename: "migration-plan.md",
        content: originalContent,
        title: "Migration Plan",
        description: "Three phase cut-over plan",
        tags: "migration,Platform, planning",
        visibility: "private",
      }),
    });
    expectStatus(res, 201);
    const doc = res.body.document;
    assert.strictEqual(doc.title, "Migration Plan");
    assert.deepStrictEqual(doc.tags, ["migration", "platform", "planning"], "tags should be normalised");
    assert.strictEqual(doc.file.category, "document");
    assert.strictEqual(doc.file.mimeType, "text/markdown");
    assert.strictEqual(doc.file.size, Buffer.byteLength(originalContent));
    assert.strictEqual(doc.version, 1);
    assert.strictEqual(doc.accessLevel, "owner");
    assert.ok(doc.file.checksum, "checksum was not computed");
    state.documentId = doc.id;
  });

  await check("upload without a file is rejected", async () => {
    const form = new FormData();
    form.append("title", "No file here");
    const res = await call("POST", "/api/documents", { token: state.ownerToken, body: form });
    expectStatus(res, 400);
    expectCode(res, "FILE_REQUIRED");
  });

  await check("a disallowed extension is rejected with 415", async () => {
    const res = await call("POST", "/api/documents", {
      token: state.ownerToken,
      body: uploadForm({ filename: "payload.exe", content: "MZ binary", title: "Nope" }),
    });
    expectStatus(res, 415);
    expectCode(res, "EXTENSION_NOT_ALLOWED");
  });

  await check("an oversized upload is rejected with 413", async () => {
    const tooBig = Buffer.alloc(3 * 1024 * 1024, 0x41); // limit is 2 MB for this run
    const res = await call("POST", "/api/documents", {
      token: state.ownerToken,
      body: uploadForm({ filename: "huge.txt", content: tooBig, title: "Too big" }),
    });
    expectStatus(res, 413);
    expectCode(res, "FILE_TOO_LARGE");
  });

  await check("a rejected upload leaves no orphaned file on disk", async () => {
    const usage = await storage.usageOnDisk();
    // Only the one successful upload should exist at this point.
    assert.strictEqual(usage.files, 1, `expected 1 stored file, found ${usage.files}`);
  });

  await check("a malformed document id is rejected before hitting the database", async () => {
    const res = await call("GET", "/api/documents/..%2F..%2Fetc%2Fpasswd", { token: state.ownerToken });
    assert.ok([400, 404, 422].includes(res.status), `unexpected status ${res.status}`);
  });

  await check("GET /api/documents/:id returns detail, versions and activity", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.id, state.documentId);
    assert.strictEqual(res.body.versions.length, 1);
    assert.ok(res.body.activity.some((a) => a.action === "document.uploaded"), "upload not audited");
  });

  await check("listing returns the document with facets", async () => {
    const res = await call("GET", "/api/documents?scope=mine", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.meta.total, 1);
    assert.strictEqual(res.body.documents[0].id, state.documentId);
    assert.ok(res.body.facets.tags.includes("migration"));
    assert.strictEqual(res.body.facets.categories.document, 1);
  });

  await check("search matches on title and misses on nonsense", async () => {
    const hit = await call("GET", "/api/documents?search=migration", { token: state.ownerToken });
    expectStatus(hit, 200);
    assert.strictEqual(hit.body.meta.total, 1);

    const miss = await call("GET", "/api/documents?search=zzzzzznotpresent", { token: state.ownerToken });
    assert.strictEqual(miss.body.meta.total, 0);
  });

  await check("regex metacharacters in search are escaped, not executed", async () => {
    const res = await call("GET", "/api/documents?search=.%2A", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.meta.total, 0, "'.*' should be treated literally");
  });

  await check("tag filter narrows results", async () => {
    const res = await call("GET", "/api/documents?tag=platform", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.meta.total, 1);
  });

  await check("GET /api/documents/tags is not shadowed by the :id route", async () => {
    const res = await call("GET", "/api/documents/tags", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.ok(Array.isArray(res.body.tags));
    assert.ok(res.body.tags.includes("migration"));
  });

  await check("download returns the exact bytes and a filename", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/download`, {
      token: state.ownerToken,
      raw: true,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.buffer.toString("utf8"), originalContent);
    assert.match(res.headers.get("content-disposition") || "", /migration-plan\.md/);
  });

  await check("the download counter increments", async () => {
    await drain();
    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.ownerToken });
    assert.strictEqual(res.body.document.downloadCount, 1);
  });

  await check("inline preview serves the file with nosniff", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/preview`, {
      token: state.ownerToken,
      raw: true,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-disposition") || "", /^inline/);
  });

  await check("text preview returns content with a truncation flag", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/preview/text`, {
      token: state.ownerToken,
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.content, originalContent);
    assert.strictEqual(res.body.truncated, false);
  });

  // -------------------------------------------------------------------------
  group("Metadata, versions & starring");

  await check("PATCH updates metadata", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.ownerToken,
      body: { title: "Migration Plan v2", description: "Revised cut-over plan", tags: ["migration", "urgent"] },
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.title, "Migration Plan v2");
    assert.deepStrictEqual(res.body.document.tags, ["migration", "urgent"]);
  });

  await check("an empty title is rejected", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.ownerToken,
      body: { title: "   " },
    });
    expectStatus(res, 422);
  });

  const revisedContent = "# Migration Plan\n\nPhase 1: dual write\nPhase 2: backfill\nPhase 3: cut over\nPhase 4: decommission\n";

  await check("uploading a new version bumps the version number", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/versions`, {
      token: state.ownerToken,
      body: uploadForm({ filename: "migration-plan.md", content: revisedContent, note: "Added phase 4" }),
    });
    expectStatus(res, 201);
    assert.strictEqual(res.body.document.version, 2);
    assert.strictEqual(res.body.document.versionCount, 2);
  });

  await check("the default download now serves the new version", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/download`, {
      token: state.ownerToken,
      raw: true,
    });
    assert.strictEqual(res.buffer.toString("utf8"), revisedContent);
  });

  await check("an older version is still retrievable by number", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/download?version=1`, {
      token: state.ownerToken,
      raw: true,
    });
    assert.strictEqual(res.buffer.toString("utf8"), originalContent);
  });

  await check("a nonexistent version returns 404", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/download?version=99`, {
      token: state.ownerToken,
    });
    expectStatus(res, 404);
    expectCode(res, "VERSION_NOT_FOUND");
  });

  await check("starring and unstarring works and is scoped to the caller", async () => {
    const starred = await call("PUT", `/api/documents/${state.documentId}/star`, { token: state.ownerToken });
    expectStatus(starred, 200);
    assert.strictEqual(starred.body.document.isStarred, true);

    const list = await call("GET", "/api/documents?scope=starred", { token: state.ownerToken });
    assert.strictEqual(list.body.meta.total, 1);

    const unstarred = await call("DELETE", `/api/documents/${state.documentId}/star`, { token: state.ownerToken });
    assert.strictEqual(unstarred.body.document.isStarred, false);
  });

  // -------------------------------------------------------------------------
  group("Per-user sharing");

  await check("a private document is invisible to another member", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.collabToken });
    expectStatus(res, 404);
    expectCode(res, "DOCUMENT_NOT_FOUND");
  });

  await check("owner grants edit access by email", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/shares`, {
      token: state.ownerToken,
      body: { email: collaborator.email, permission: "edit" },
    });
    expectStatus(res, 201);
    assert.strictEqual(res.body.share.permission, "edit");
    assert.strictEqual(res.body.recipientExists, true);
    state.userShareId = res.body.share.id;
  });

  await check("the recipient can now read the document", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.collabToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.accessLevel, "edit");
    assert.strictEqual(res.body.document.permissions.canEdit, true);
    assert.strictEqual(res.body.document.permissions.canManage, false);
  });

  await check("the document appears in the recipient's 'shared' scope", async () => {
    const res = await call("GET", "/api/documents?scope=shared", { token: state.collabToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.meta.total, 1);
    assert.strictEqual(res.body.documents[0].id, state.documentId);
  });

  await check("an editor may change the description", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.collabToken,
      body: { description: "Edited by the collaborator" },
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.description, "Edited by the collaborator");
  });

  await check("an editor may NOT change visibility", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.collabToken,
      body: { visibility: "public" },
    });
    expectStatus(res, 403);
    expectCode(res, "INSUFFICIENT_ACCESS");
  });

  await check("an editor may NOT delete the document", async () => {
    const res = await call("DELETE", `/api/documents/${state.documentId}?permanent=true`, {
      token: state.collabToken,
    });
    expectStatus(res, 403);
    expectCode(res, "INSUFFICIENT_ACCESS");
  });

  await check("an editor may NOT see or manage the share list", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}/shares`, { token: state.collabToken });
    expectStatus(res, 403);
  });

  await check("re-sharing the same email updates rather than duplicates the grant", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/shares`, {
      token: state.ownerToken,
      body: { email: collaborator.email, permission: "view" },
    });
    expectStatus(res, 201);
    assert.strictEqual(res.body.share.id, state.userShareId, "a second grant row was created");

    const shares = await call("GET", `/api/documents/${state.documentId}/shares`, { token: state.ownerToken });
    const userShares = shares.body.shares.filter((s) => s.type === "user");
    assert.strictEqual(userShares.length, 1, `expected 1 user share, got ${userShares.length}`);
    assert.strictEqual(userShares[0].permission, "view");
  });

  await check("downgraded to view, the collaborator can no longer edit", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.collabToken,
      body: { description: "should not stick" },
    });
    expectStatus(res, 403);
  });

  await check("sharing with yourself is rejected", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/shares`, {
      token: state.ownerToken,
      body: { email: owner.email },
    });
    expectStatus(res, 400);
    expectCode(res, "SELF_SHARE");
  });

  await check("revoking the grant removes access", async () => {
    const revoke = await call("DELETE", `/api/documents/${state.documentId}/shares/${state.userShareId}`, {
      token: state.ownerToken,
    });
    expectStatus(revoke, 200);

    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.collabToken });
    expectStatus(res, 404);
  });

  // -------------------------------------------------------------------------
  group("Public share links");

  await check("a public link can be created with a password and a download cap", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/links`, {
      token: state.ownerToken,
      body: { permission: "view", password: "open-sesame", expiresInDays: 7, maxDownloads: 2 },
    });
    expectStatus(res, 201);
    assert.ok(res.body.share.token);
    assert.strictEqual(res.body.share.hasPassword, true);
    assert.strictEqual(res.body.share.maxDownloads, 2);
    assert.match(res.body.share.url, /\/s\//);
    state.linkToken = res.body.share.token;
    state.linkShareId = res.body.share.id;
  });

  await check("the link cannot be opened without the password", async () => {
    const res = await call("GET", `/api/share/${state.linkToken}`);
    expectStatus(res, 401);
    expectCode(res, "LINK_PASSWORD_REQUIRED");
  });

  await check("the link rejects a wrong password", async () => {
    const res = await call("GET", `/api/share/${state.linkToken}`, {
      headers: { "x-share-password": "guessing" },
    });
    expectStatus(res, 401);
    expectCode(res, "LINK_PASSWORD_INVALID");
  });

  await check("the link opens anonymously with the correct password", async () => {
    const res = await call("GET", `/api/share/${state.linkToken}`, {
      headers: { "x-share-password": "open-sesame" },
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.title, "Migration Plan v2");
    assert.strictEqual(res.body.share.remainingDownloads, 2);
    assert.ok(res.body.links.download.endsWith("/download"));
  });

  await check("the public payload never exposes internal fields", async () => {
    const res = await call("GET", `/api/share/${state.linkToken}?password=open-sesame`);
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.storedName, undefined, "storedName leaked");
    assert.strictEqual(res.body.share.passwordHash, undefined, "passwordHash leaked");
  });

  await check("anonymous download through the link works", async () => {
    const res = await call("GET", `/api/share/${state.linkToken}/download?password=open-sesame`, { raw: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.buffer.toString("utf8"), revisedContent);
  });

  await check("the download cap is enforced", async () => {
    await drain();
    const second = await call("GET", `/api/share/${state.linkToken}/download?password=open-sesame`, { raw: true });
    assert.strictEqual(second.status, 200, "second download should still be allowed");
    await drain();

    const third = await call("GET", `/api/share/${state.linkToken}?password=open-sesame`);
    expectStatus(third, 403);
    expectCode(third, "LINK_EXHAUSTED");
  });

  await check("an unknown token returns 404", async () => {
    const res = await call("GET", "/api/share/aaaaaaaaaaaaaaaaaaaaaaaa");
    expectStatus(res, 404);
    expectCode(res, "LINK_NOT_FOUND");
  });

  await check("an already-expired link is refused", async () => {
    // Create a link, then expire it directly through the repository.
    const created = await call("POST", `/api/documents/${state.documentId}/links`, {
      token: state.ownerToken,
      body: { permission: "view" },
    });
    expectStatus(created, 201);

    const { db } = require("../server/data");
    await db.shares.updateById(created.body.share.id, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await call("GET", `/api/share/${created.body.share.token}`);
    expectStatus(res, 403);
    expectCode(res, "LINK_EXPIRED");
  });

  await check("a revoked link is refused", async () => {
    const revoke = await call("DELETE", `/api/documents/${state.documentId}/shares/${state.linkShareId}`, {
      token: state.ownerToken,
    });
    expectStatus(revoke, 200);

    const res = await call("GET", `/api/share/${state.linkToken}?password=open-sesame`);
    expectStatus(res, 403);
    expectCode(res, "LINK_REVOKED");
  });

  // -------------------------------------------------------------------------
  group("Visibility levels");

  await check("an 'internal' document is readable by any signed-in user", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.ownerToken,
      body: { visibility: "internal" },
    });
    expectStatus(res, 200);

    const read = await call("GET", `/api/documents/${state.documentId}`, { token: state.collabToken });
    expectStatus(read, 200);
    assert.strictEqual(read.body.document.accessLevel, "view");
  });

  await check("but still not writable by them", async () => {
    const res = await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.collabToken,
      body: { title: "hijacked" },
    });
    expectStatus(res, 403);
  });

  await check("reverting to private hides it again", async () => {
    await call("PATCH", `/api/documents/${state.documentId}`, {
      token: state.ownerToken,
      body: { visibility: "private" },
    });
    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.collabToken });
    expectStatus(res, 404);
  });

  // -------------------------------------------------------------------------
  group("Insights");

  await check("dashboard overview aggregates correctly", async () => {
    const res = await call("GET", "/api/stats/overview", { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.totals.documents, 1);
    assert.ok(res.body.storage.usedBytes > 0, "storage should be non-zero");
    assert.ok(Array.isArray(res.body.timeline) && res.body.timeline.length === 14);
    assert.ok(res.body.breakdown.categories.some((c) => c.name === "document"));
    assert.ok(res.body.activity.length > 0);
  });

  await check("the audit trail records the actions we performed", async () => {
    const res = await call("GET", "/api/auth/me/activity?limit=100", { token: state.ownerToken });
    expectStatus(res, 200);
    const actions = new Set(res.body.activities.map((a) => a.action));
    for (const expected of [
      "user.registered",
      "document.uploaded",
      "document.updated",
      "document.version_added",
      "document.downloaded",
      "share.user_granted",
      "share.link_created",
      "share.link_revoked",
    ]) {
      assert.ok(actions.has(expected), `missing audit action: ${expected}`);
    }
  });

  // -------------------------------------------------------------------------
  group("Trash & permanent deletion");

  await check("trashing removes the document from the active listing", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/trash`, { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.status, "trashed");

    const active = await call("GET", "/api/documents?scope=mine", { token: state.ownerToken });
    assert.strictEqual(active.body.meta.total, 0);

    const trash = await call("GET", "/api/documents?scope=trash", { token: state.ownerToken });
    assert.strictEqual(trash.body.meta.total, 1);
  });

  await check("restoring brings it back", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/restore`, { token: state.ownerToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.status, "active");
  });

  await check("restoring a document that is not trashed is rejected", async () => {
    const res = await call("POST", `/api/documents/${state.documentId}/restore`, { token: state.ownerToken });
    expectStatus(res, 400);
    expectCode(res, "NOT_TRASHED");
  });

  await check("permanent deletion removes every stored version from disk", async () => {
    const before = await storage.usageOnDisk();
    assert.strictEqual(before.files, 2, `expected 2 stored versions, found ${before.files}`);

    const res = await call("DELETE", `/api/documents/${state.documentId}?permanent=true`, {
      token: state.ownerToken,
    });
    expectStatus(res, 200);
    assert.strictEqual(res.body.deleted, true);
    assert.strictEqual(res.body.filesRemoved, 2);

    const after = await storage.usageOnDisk();
    assert.strictEqual(after.files, 0, `files left behind: ${after.files}`);
  });

  await check("the deleted document is gone", async () => {
    const res = await call("GET", `/api/documents/${state.documentId}`, { token: state.ownerToken });
    expectStatus(res, 404);
  });

  await check("its share rows were cleaned up", async () => {
    const { db } = require("../server/data");
    assert.strictEqual(await db.shares.count({ documentId: state.documentId }), 0);
  });

  await check("the audit trail survives deletion", async () => {
    const { db } = require("../server/data");
    assert.ok((await db.activities.count({ documentId: state.documentId })) > 0);
  });

  // -------------------------------------------------------------------------
  group("Persistence");

  /**
   * Same intent on both drivers — credentials are stored as scrypt hashes and
   * never in the clear — but read back through whichever medium is in use, so
   * this is a real durability check rather than one that skips on mongo.
   */
  await check("credentials are persisted as scrypt hashes, never in the clear", async () => {
    await drain();

    let records;
    if (process.env.DB_DRIVER === "mongo") {
      const mongoose = require("mongoose");
      // Read through the raw collection, bypassing our own serialisation.
      records = await mongoose.connection.db.collection("users").find({}).toArray();
    } else {
      const file = path.join(ROOT, ".verify", "data", "users.json");
      const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
      assert.strictEqual(parsed.collection, "users");
      records = parsed.records;
    }

    assert.ok(records.length >= 2, `expected at least 2 stored users, found ${records.length}`);
    assert.ok(
      records.every((r) => typeof r.passwordHash === "string" && r.passwordHash.startsWith("scrypt$")),
      "passwords must be stored as scrypt hashes"
    );
    assert.ok(
      records.every((r) => !("password" in r)),
      "a plaintext password must never be stored"
    );
    assert.ok(
      records.every((r) => typeof r._id === "string" && /^[0-9a-f]{24}$/.test(r._id)),
      "ids must be stored in the same 24-hex form on both drivers"
    );
  });

  await check("a record written by this driver reloads with identical values", async () => {
    const { db } = require("../server/data");

    const written = await db.documents.create({
      title: "Round trip",
      description: "",
      tags: ["alpha", "beta"],
      ownerId: state.owner.id,
      ownerName: "Verity Okonkwo",
      visibility: "private",
      storedName: "round-trip.bin",
      originalName: "round-trip.bin",
      mimeType: "application/octet-stream",
      extension: "bin",
      size: 12,
      checksum: "abc",
      category: "other",
      version: 1,
      versions: [{ version: 1, storedName: "round-trip.bin", originalName: "round-trip.bin", mimeType: "application/octet-stream", size: 12, checksum: "abc", uploadedAt: new Date().toISOString(), uploadedBy: state.owner.id, note: "" }],
      downloadCount: 0,
      viewCount: 0,
      starredBy: [],
      status: "active",
      trashedAt: null,
    });

    await drain();
    const reloaded = await db.documents.findById(written.id);

    assert.deepStrictEqual(reloaded.tags, ["alpha", "beta"], "arrays must survive a round trip");
    assert.strictEqual(reloaded.versions.length, 1, "nested version records must survive");
    assert.strictEqual(reloaded.versions[0].size, 12);
    assert.strictEqual(reloaded.trashedAt, null, "explicit nulls must not become undefined");
    assert.strictEqual(typeof reloaded.createdAt, "string", "timestamps are ISO strings on both drivers");

    await db.documents.deleteById(written.id);
  });

  await check("the SPA fallback responds on a non-API route", async () => {
    const res = await call("GET", "/documents", { raw: true });
    // 200 once the client is built, 503 with build instructions before then.
    assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`);
  });

  await runRegressions();
}

// ---------------------------------------------------------------------------
// Regressions
//
// One check per bug found by auditing the first version. Each of these failed
// before the corresponding fix; they exist so it cannot come back.
// ---------------------------------------------------------------------------

async function runRegressions() {
  const { db } = require("../server/data");

  group("Regression: starred documents respect revoked access");

  const owner = { token: state.ownerToken };
  let internalId;

  await check("a document made 'internal' is visible to another member", async () => {
    const form = uploadForm({
      filename: "internal-notes.txt",
      content: "team readable",
      title: "Internal Notes",
      visibility: "internal",
    });
    const created = await call("POST", "/api/documents", { token: owner.token, body: form });
    expectStatus(created, 201);
    internalId = created.body.document.id;

    expectStatus(await call("GET", `/api/documents/${internalId}`, { token: state.collabToken }), 200);
  });

  await check("the other member stars it", async () => {
    const res = await call("PUT", `/api/documents/${internalId}/star`, { token: state.collabToken });
    expectStatus(res, 200);
    assert.strictEqual(res.body.document.isStarred, true);
  });

  await check("once it is made private, it vanishes from their starred list", async () => {
    expectStatus(
      await call("PATCH", `/api/documents/${internalId}`, {
        token: owner.token,
        body: { visibility: "private" },
      }),
      200
    );

    const starred = await call("GET", "/api/documents?scope=starred", { token: state.collabToken });
    expectStatus(starred, 200);
    assert.strictEqual(
      starred.body.meta.total,
      0,
      "a stale star must not keep leaking the title, filename, owner and size"
    );
  });

  await check("and the detail and download routes still refuse them", async () => {
    expectStatus(await call("GET", `/api/documents/${internalId}`, { token: state.collabToken }), 404);
    expectStatus(await call("GET", `/api/documents/${internalId}/download`, { token: state.collabToken }), 404);
  });

  await check("the owner's own starred list is unaffected", async () => {
    expectStatus(await call("PUT", `/api/documents/${internalId}/star`, { token: owner.token }), 200);
    const mine = await call("GET", "/api/documents?scope=starred", { token: owner.token });
    assert.strictEqual(mine.body.meta.total, 1);
  });

  group("Regression: a download cap cannot be exceeded");

  let capToken;

  await check("a link capped at 5 serves exactly 5 of 25 parallel downloads", async () => {
    const created = await call("POST", `/api/documents/${internalId}/links`, {
      token: owner.token,
      body: { permission: "view", maxDownloads: 5 },
    });
    expectStatus(created, 201);
    capToken = created.body.share.token;

    const attempts = await Promise.all(
      Array.from({ length: 25 }, () => call("GET", `/api/share/${capToken}/download`, { raw: true }))
    );

    const served = attempts.filter((res) => res.status === 200).length;
    assert.strictEqual(served, 5, `expected exactly 5 successful downloads, got ${served}`);
  });

  await check("the recorded counter matches what was served, with no lost updates", async () => {
    await drain();
    const shares = await db.shares.find({ token: capToken });
    assert.strictEqual(shares[0].downloadCount, 5, "a read-modify-write would under-count here");
  });

  await check("further attempts report the link as exhausted", async () => {
    const res = await call("GET", `/api/share/${capToken}`);
    expectStatus(res, 403);
    expectCode(res, "LINK_EXHAUSTED");
  });

  await check("previewing a link does not spend its allowance", async () => {
    const created = await call("POST", `/api/documents/${internalId}/links`, {
      token: owner.token,
      body: { maxDownloads: 2 },
    });
    const token = created.body.share.token;

    await call("GET", `/api/share/${token}/preview`, { raw: true });
    await call("GET", `/api/share/${token}/preview`, { raw: true });
    await drain();

    const [share] = await db.shares.find({ token });
    assert.strictEqual(share.downloadCount, 0, "only a download should consume the cap");
  });

  group("Regression: the storage quota is enforced");

  await check("an upload beyond the quota is refused with 413", async () => {
    await db.users.updateById(state.owner.id, { storageQuotaBytes: 4096 });

    const res = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({ filename: "too-much.txt", content: "z".repeat(8192), title: "Too much" }),
    });
    expectStatus(res, 413);
    expectCode(res, "STORAGE_QUOTA_EXCEEDED");
    assert.ok(res.body.error.details[0].quotaBytes === 4096);
  });

  await check("the quota counts version history, not just current files", async () => {
    await db.users.updateById(state.owner.id, { storageQuotaBytes: 100 * 1024 * 1024 });

    const before = await call("GET", "/api/stats/overview", { token: owner.token });
    const baseline = before.body.storage.usedBytes;

    const res = await call("POST", `/api/documents/${internalId}/versions`, {
      token: owner.token,
      body: uploadForm({ filename: "internal-notes.txt", content: "y".repeat(4096) }),
    });
    expectStatus(res, 201);

    const after = await call("GET", "/api/stats/overview", { token: owner.token });
    assert.ok(
      after.body.storage.usedBytes >= baseline + 4096,
      "the superseded version still occupies disk and must still be charged"
    );
  });

  await check("trashed documents keep counting until they are purged", async () => {
    const created = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({ filename: "doomed.txt", content: "w".repeat(2048), title: "Doomed" }),
    });
    expectStatus(created, 201);

    const before = (await call("GET", "/api/stats/overview", { token: owner.token })).body.storage.usedBytes;
    expectStatus(await call("POST", `/api/documents/${created.body.document.id}/trash`, { token: owner.token }), 200);

    const after = (await call("GET", "/api/stats/overview", { token: owner.token })).body.storage.usedBytes;
    assert.strictEqual(after, before, "trashing must not pretend the bytes are gone");

    expectStatus(await call("DELETE", "/api/documents/trash/empty", { token: owner.token }), 200);
    const emptied = (await call("GET", "/api/stats/overview", { token: owner.token })).body.storage.usedBytes;
    assert.ok(emptied < before, "emptying the trash should free the space");
  });

  group("Regression: uploads are checked by content, not by name");

  await check("a Windows executable named .pdf is refused", async () => {
    const res = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({
        filename: "invoice.pdf",
        content: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
        title: "Disguised",
      }),
    });
    expectStatus(res, 415);
    expectCode(res, "EXECUTABLE_REJECTED");
  });

  await check("an ELF binary named .txt is refused", async () => {
    const res = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({
        filename: "readme.txt",
        content: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
        title: "Disguised elf",
      }),
    });
    expectStatus(res, 415);
    expectCode(res, "EXECUTABLE_REJECTED");
  });

  await check("plain text named .pdf is refused as a mismatch", async () => {
    const res = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({ filename: "fake.pdf", content: "not a pdf at all", title: "Fake" }),
    });
    expectStatus(res, 415);
    expectCode(res, "CONTENT_MISMATCH");
  });

  await check("a genuine PDF and a plain .md are both accepted", async () => {
    expectStatus(
      await call("POST", "/api/documents", {
        token: owner.token,
        body: uploadForm({ filename: "real.pdf", content: "%PDF-1.7\n1 0 obj\n", title: "Real PDF" }),
      }),
      201
    );
    expectStatus(
      await call("POST", "/api/documents", {
        token: owner.token,
        body: uploadForm({ filename: "notes.md", content: "# Heading\n", title: "Notes" }),
      }),
      201
    );
  });

  await check("rejected uploads leave nothing behind on disk", async () => {
    const before = await storage.usageOnDisk();
    await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({ filename: "x.pdf", content: Buffer.from([0x4d, 0x5a]), title: "nope" }),
    });
    const after = await storage.usageOnDisk();
    assert.strictEqual(after.files, before.files);
  });

  group("Regression: tokens can be revoked");

  await check("signing out everywhere invalidates the token that did it", async () => {
    const throwaway = await call("POST", "/api/auth/register", {
      body: {
        firstName: "Temp",
        lastName: "Session",
        email: `revoke-${stamp}@example.com`,
        password: "Revocation9Test",
      },
    });
    expectStatus(throwaway, 201);
    const token = throwaway.body.token;

    expectStatus(await call("GET", "/api/auth/me", { token }), 200);
    expectStatus(await call("POST", "/api/auth/logout-all", { token }), 200);

    const after = await call("GET", "/api/auth/me", { token });
    expectStatus(after, 401);
    expectCode(after, "TOKEN_REVOKED");
  });

  await check("changing a password kills other sessions but keeps the caller signed in", async () => {
    const email = `rotate-${stamp}@example.com`;
    const created = await call("POST", "/api/auth/register", {
      body: { firstName: "Rot", lastName: "Ate", email, password: "FirstPass9word" },
    });
    expectStatus(created, 201);

    const otherDevice = (await call("POST", "/api/auth/login", { body: { email, password: "FirstPass9word" } }))
      .body.token;

    const changed = await call("POST", "/api/auth/change-password", {
      token: created.body.token,
      body: { currentPassword: "FirstPass9word", newPassword: "SecondPass9word" },
    });
    expectStatus(changed, 200);
    assert.ok(changed.body.token, "a replacement token must be issued");

    expectStatus(await call("GET", "/api/auth/me", { token: otherDevice }), 401);
    expectStatus(await call("GET", "/api/auth/me", { token: changed.body.token }), 200);
  });

  group("Regression: public links are read-only");

  await check("requesting an editable link is rejected rather than silently downgraded", async () => {
    const res = await call("POST", `/api/documents/${internalId}/links`, {
      token: owner.token,
      body: { permission: "edit" },
    });
    expectStatus(res, 422);
  });

  group("Administration");

  await check("an admin can list accounts with their real storage footprint", async () => {
    const res = await call("GET", "/api/admin/users", { token: owner.token });
    expectStatus(res, 200);
    assert.ok(res.body.users.length >= 2);

    const me = res.body.users.find((user) => user.id === state.owner.id);
    assert.ok(me, "the caller should appear in the listing");
    assert.strictEqual(typeof me.usedBytes, "number");
    assert.strictEqual(me.passwordHash, undefined, "hashes must never be listed");
    assert.strictEqual(me.tokenVersion, undefined, "internal bookkeeping must not leak");
  });

  await check("a member is forbidden from the admin routes", async () => {
    const res = await call("GET", "/api/admin/users", { token: state.collabToken });
    expectStatus(res, 403);
    expectCode(res, "INSUFFICIENT_ROLE");
  });

  await check("the only active admin cannot demote themselves", async () => {
    const res = await call("PATCH", `/api/admin/users/${state.owner.id}`, {
      token: owner.token,
      body: { role: "member" },
    });
    expectStatus(res, 400);
    expectCode(res, "LAST_ADMIN");
  });

  await check("an admin cannot deactivate their own account", async () => {
    const res = await call("PATCH", `/api/admin/users/${state.owner.id}`, {
      token: owner.token,
      body: { isActive: false },
    });
    expectStatus(res, 400);
    expectCode(res, "SELF_DEACTIVATE");
  });

  await check("deactivating a member signs them out immediately", async () => {
    expectStatus(
      await call("PATCH", `/api/admin/users/${state.collab.id}`, {
        token: owner.token,
        body: { isActive: false },
      }),
      200
    );

    const res = await call("GET", "/api/auth/me", { token: state.collabToken });
    expectStatus(res, 403);
    expectCode(res, "ACCOUNT_DISABLED");

    // Restore, so later assertions are not affected.
    expectStatus(
      await call("PATCH", `/api/admin/users/${state.collab.id}`, {
        token: owner.token,
        body: { isActive: true },
      }),
      200
    );
  });

  await check("quotas can be changed and take effect immediately", async () => {
    expectStatus(
      await call("PATCH", `/api/admin/users/${state.collab.id}`, {
        token: owner.token,
        body: { storageQuotaGb: 0.000001 }, // ~1 KB
      }),
      200
    );

    const collabToken = (await call("POST", "/api/auth/login", {
      body: { email: collaborator.email, password: collaborator.password },
    })).body.token;

    const res = await call("POST", "/api/documents", {
      token: collabToken,
      body: uploadForm({ filename: "over.txt", content: "q".repeat(4096), title: "Over" }),
    });
    expectStatus(res, 413);
    expectCode(res, "STORAGE_QUOTA_EXCEEDED");
  });

  group("Storage reconciliation & retention");

  await check("a healthy instance reports no orphaned or missing files", async () => {
    const res = await call("GET", "/api/admin/storage", { token: owner.token });
    expectStatus(res, 200);
    assert.strictEqual(res.body.orphanedFiles, 0, `orphans: ${JSON.stringify(res.body.sample.orphaned)}`);
    assert.strictEqual(res.body.missingFiles, 0, `missing: ${JSON.stringify(res.body.sample.missing)}`);
    assert.ok(res.body.referencedFiles > 0);
  });

  await check("version history is not mistaken for an orphan", async () => {
    // The old heuristic (files on disk minus document count) counted every
    // superseded version as unreferenced.
    const res = await call("GET", "/api/admin/storage", { token: owner.token });
    assert.ok(
      res.body.referencedFiles >= res.body.filesOnDisk,
      `referenced ${res.body.referencedFiles} should cover all ${res.body.filesOnDisk} files on disk`
    );
    assert.strictEqual(res.body.orphanedFiles, 0);
  });

  await check("a genuinely stray file is detected and can be purged", async () => {
    await fsp.writeFile(path.join(ROOT, ".verify", "uploads", "stray.txt"), "left behind", "utf8");

    const detected = await call("GET", "/api/admin/storage", { token: owner.token });
    assert.strictEqual(detected.body.orphanedFiles, 1);

    const purged = await call("POST", "/api/admin/storage/purge-orphans", { token: owner.token });
    expectStatus(purged, 200);
    assert.strictEqual(purged.body.removed, 1);

    const clean = await call("GET", "/api/admin/storage", { token: owner.token });
    assert.strictEqual(clean.body.orphanedFiles, 0);
  });

  await check("a record whose file has vanished is reported as missing", async () => {
    const created = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({ filename: "vanishing.txt", content: "here for now", title: "Vanishing" }),
    });
    expectStatus(created, 201);

    const [record] = await db.documents.find({ id: created.body.document.id });
    await fsp.unlink(storage.pathFor(record.storedName));

    const res = await call("GET", "/api/admin/storage", { token: owner.token });
    assert.strictEqual(res.body.missingFiles, 1);

    // A download of the missing file must fail cleanly, not 500.
    const download = await call("GET", `/api/documents/${created.body.document.id}/download`, {
      token: owner.token,
    });
    expectStatus(download, 404);
    expectCode(download, "FILE_MISSING");

    await call("DELETE", `/api/documents/${created.body.document.id}?permanent=true`, { token: owner.token });
  });

  await check("the retention sweep purges trash past its window", async () => {
    const created = await call("POST", "/api/documents", {
      token: owner.token,
      body: uploadForm({ filename: "stale.txt", content: "old news", title: "Stale" }),
    });
    const id = created.body.document.id;
    expectStatus(await call("POST", `/api/documents/${id}/trash`, { token: owner.token }), 200);

    // Backdate it past any plausible window.
    await db.documents.updateById(id, {
      trashedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    });

    const maintenance = require("../server/services/maintenance.service");
    const result = await maintenance.purgeTrash(30);

    assert.strictEqual(result.documents, 1, "the stale trashed document should be purged");
    expectStatus(await call("GET", `/api/documents/${id}`, { token: owner.token }), 404);
  });

  await check("the retention sweep prunes old audit entries", async () => {
    const maintenance = require("../server/services/maintenance.service");

    const created = await db.activities.create({
      action: "document.viewed",
      actorId: state.owner.id,
      createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    });

    const result = await maintenance.pruneActivity(30);
    assert.ok(result.removed >= 1);
    assert.strictEqual(await db.activities.findById(created.id), null);
  });

  await check("retention of 0 disables a sweep instead of deleting everything", async () => {
    const maintenance = require("../server/services/maintenance.service");
    const before = await db.activities.count({});

    assert.strictEqual((await maintenance.pruneActivity(0)).skipped, true);
    assert.strictEqual((await maintenance.purgeTrash(0)).skipped, true);
    assert.strictEqual(await db.activities.count({}), before, "nothing should have been removed");
  });
}

// ---------------------------------------------------------------------------

(async () => {
  let server;
  try {
    server = await main();
  } catch (err) {
    console.error(c.red(`Could not start the server: ${err.message}`));
    console.error(err);
    process.exit(1);
  }

  const startedAt = Date.now();
  try {
    await run();
  } catch (err) {
    console.error(c.red(`\nHarness crashed: ${err.message}`));
    console.error(err);
    results.push({ group: "harness", description: "run to completion", ok: false, error: err });
  }

  const failed = results.filter((r) => !r.ok);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(2);

  console.log(`\n${"─".repeat(64)}`);
  console.log(`${c.bold("Driver")}  ${c.cyan(process.env.DB_DRIVER)}`);
  console.log(
    `${c.bold("Result")}  ${c.green(`${results.length - failed.length} passed`)}` +
      (failed.length ? `  ${c.red(`${failed.length} failed`)}` : "") +
      `  ${c.dim(`(${results.length} checks in ${seconds}s)`)}`
  );

  if (failed.length) {
    console.log(`\n${c.red(c.bold("Failures"))}`);
    for (const failure of failed) {
      console.log(`  ${c.red("•")} [${failure.group}] ${failure.description}`);
    }
  }
  console.log(`${"─".repeat(64)}\n`);

  await new Promise((resolve) => server.close(resolve));
  await drain();

  // Drop the scratch database before disconnecting, so a mongo run leaves the
  // cluster exactly as it was found.
  if (process.env.DB_DRIVER === "mongo") {
    try {
      const mongoose = require("mongoose");
      await mongoose.connection.dropDatabase();
      console.log(c.dim(`Dropped scratch database ${MONGO_SCRATCH_DB}`));
    } catch (err) {
      console.log(c.red(`Could not drop ${MONGO_SCRATCH_DB}: ${err.message}`));
    }
  }

  await disconnect();
  fs.rmSync(SANDBOX, { recursive: true, force: true });

  process.exit(failed.length ? 1 : 0);
})();
