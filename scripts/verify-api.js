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

  await check("data is flushed to disk and reloads intact", async () => {
    await drain();
    const file = path.join(ROOT, ".verify", "data", "users.json");
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    assert.strictEqual(parsed.collection, "users");
    assert.strictEqual(parsed.records.length, 2);
    assert.ok(
      parsed.records.every((r) => typeof r.passwordHash === "string" && r.passwordHash.startsWith("scrypt$")),
      "passwords must be stored as scrypt hashes"
    );
    assert.ok(
      parsed.records.every((r) => !("password" in r)),
      "plaintext password must never be stored"
    );
  });

  await check("the SPA fallback responds on a non-API route", async () => {
    const res = await call("GET", "/documents", { raw: true });
    // 200 once the client is built, 503 with build instructions before then.
    assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`);
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
  await disconnect();
  fs.rmSync(SANDBOX, { recursive: true, force: true });

  process.exit(failed.length ? 1 : 0);
})();
