"use strict";

/**
 * The client needs an extension→category map before an upload reaches the
 * server, so the table is necessarily duplicated. This file is the guard that
 * keeps the copies honest: add a type on one side only and it fails.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const server = require("../server/utils/files");

let client;

test.before(async () => {
  client = await import("../client/src/lib/fileTypes.js");
});

test("the client and server category maps are identical", () => {
  assert.deepEqual(
    client.CATEGORY_BY_EXTENSION,
    server.CATEGORY_BY_EXTENSION,
    "client/src/lib/fileTypes.js has drifted from server/utils/files.js"
  );
});

test("categoryOf agrees across both implementations", () => {
  const samples = [
    "report.pdf",
    "notes.MD",
    "sheet.xlsx",
    "deck.pptx",
    "photo.JPEG",
    "archive.tar.gz",
    "song.mp3",
    "clip.mp4",
    "config.yaml",
    "script.py",
    "unknown.xyz",
    "no-extension",
    "",
    ".hidden",
    "trailing.",
  ];

  for (const sample of samples) {
    assert.equal(
      client.categoryOf(sample),
      server.categoryOf(sample),
      `categoryOf disagrees for ${JSON.stringify(sample)}`
    );
  }
});

test("extensionOf agrees across both implementations", () => {
  const samples = [
    "a.pdf",
    "a.b.c.PDF",
    "archive.tar.gz",
    "no-extension",
    "",
    ".hidden",
    "trailing.",
    "UPPER.TXT",
    "weird name with spaces.docx",
  ];

  for (const sample of samples) {
    assert.equal(
      client.extensionOf(sample),
      server.extensionOf(sample),
      `extensionOf disagrees for ${JSON.stringify(sample)}`
    );
  }
});

test("every mapped extension resolves to a known category", () => {
  const known = new Set([
    "pdf", "document", "spreadsheet", "presentation",
    "image", "archive", "audio", "video", "code", "other",
  ]);

  for (const [extension, category] of Object.entries(server.CATEGORY_BY_EXTENSION)) {
    assert.equal(known.has(category), true, `"${extension}" maps to unknown category "${category}"`);
  }
});

test("filenames are sanitised into something safe to store", () => {
  const { sanitizeFilename } = server;

  // Directory traversal must not survive.
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("/absolute/path/file.pdf"), "file.pdf");
  assert.equal(sanitizeFilename("..\\..\\windows\\system32"), "system32");

  // Leading dots (hidden files) and shell-significant characters go.
  assert.equal(sanitizeFilename("...hidden.txt"), "hidden.txt");
  assert.match(sanitizeFilename('bad:name*with?chars".txt'), /^[^:*?"]+$/);

  // Always returns something usable.
  assert.equal(sanitizeFilename(""), "file");
  assert.equal(sanitizeFilename("."), "file");
  assert.equal(sanitizeFilename("/"), "file");

  // Long names are clamped but keep their extension.
  const long = sanitizeFilename(`${"a".repeat(400)}.pdf`);
  assert.ok(long.length <= 180, `expected <=180 chars, got ${long.length}`);
  assert.ok(long.endsWith(".pdf"), "the extension must survive truncation");
});

test("inline preview is allowed only for formats a browser renders safely", () => {
  const { isInlinePreviewable } = server;

  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv"]) {
    assert.equal(isInlinePreviewable(mime), true, `${mime} should be previewable`);
  }

  // SVG is deliberately excluded: inline SVG can carry script.
  assert.equal(isInlinePreviewable("image/svg+xml"), false);
  assert.equal(isInlinePreviewable("text/html"), false);
  assert.equal(isInlinePreviewable("application/octet-stream"), false);
  assert.equal(isInlinePreviewable(""), false);
});
