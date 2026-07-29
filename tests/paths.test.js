"use strict";

/**
 * The router's path handling.
 *
 * `normalizeTo` is the app's only defence against an open redirect, so the
 * hostile inputs below are the point of this file rather than an afterthought.
 * They are the published attack shapes for the React Router advisory this
 * hand-rolled router exists to avoid.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let paths;

test.before(async () => {
  // The client is ESM; a dynamic import bridges it into this CommonJS test.
  paths = await import("../client/src/lib/paths.js");
});

test("normalizeTo keeps ordinary internal paths intact", () => {
  const { normalizeTo } = paths;

  assert.equal(normalizeTo("/"), "/");
  assert.equal(normalizeTo("/documents"), "/documents");
  assert.equal(normalizeTo("/documents?search=q"), "/documents?search=q");
  assert.equal(normalizeTo("/s/abc123"), "/s/abc123");
  assert.equal(normalizeTo("/a/b/c#frag"), "/a/b/c#frag");
});

test("normalizeTo makes relative paths absolute", () => {
  assert.equal(paths.normalizeTo("documents"), "/documents");
  assert.equal(paths.normalizeTo("settings/profile"), "/settings/profile");
});

test("normalizeTo refuses anything that could leave the origin", () => {
  const { normalizeTo } = paths;

  const hostile = [
    // Scheme-relative — the classic protocol-less redirect.
    "//evil.com",
    "//evil.com/path",
    // Backslash variants: browsers normalise these to slashes, which is exactly
    // the bypass behind the advisory.
    "\\\\evil.com",
    "\\/evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    // Absolute URLs.
    "http://evil.com",
    "https://evil.com/steal",
    "HTTPS://evil.com",
    // Script and data URLs.
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ];

  for (const input of hostile) {
    const result = normalizeTo(input);
    assert.equal(
      result.startsWith("/") && !result.startsWith("//"),
      true,
      `normalizeTo(${JSON.stringify(input)}) returned ${JSON.stringify(result)}, which is not a safe internal path`
    );
    assert.equal(
      /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(result),
      false,
      `normalizeTo(${JSON.stringify(input)}) kept a scheme: ${result}`
    );
  }
});

test("normalizeTo falls back to root for non-strings and empties", () => {
  const { normalizeTo } = paths;

  for (const input of ["", null, undefined, 42, {}, [], true]) {
    assert.equal(normalizeTo(input), "/");
  }
});

test("matchPath matches literal segments exactly", () => {
  const { matchPath } = paths;

  assert.deepEqual(matchPath("/documents", "/documents"), {});
  assert.equal(matchPath("/documents", "/document"), null);
  assert.equal(matchPath("/documents", "/documents/extra"), null, "trailing segments must not match");
  assert.equal(matchPath("/documents", "/"), null);
});

test("matchPath captures dynamic segments", () => {
  const { matchPath } = paths;

  assert.deepEqual(matchPath("/s/:token", "/s/abc-123_XYZ"), { token: "abc-123_XYZ" });
  assert.deepEqual(matchPath("/documents/:id", "/documents/507f1f77bcf86cd799439011"), {
    id: "507f1f77bcf86cd799439011",
  });
  assert.equal(matchPath("/s/:token", "/s"), null, "a missing segment must not match");
});

test("matchPath treats * as a catch-all", () => {
  const { matchPath } = paths;

  assert.deepEqual(matchPath("*", "/literally/anything"), {});
  assert.deepEqual(matchPath("/settings/*", "/settings/deep/nested"), {});
});

test("matchPath decodes percent-encoding and survives malformed escapes", () => {
  const { matchPath } = paths;

  assert.deepEqual(matchPath("/s/:token", "/s/a%20b"), { token: "a b" });
  // A lone % is not valid UTF-8 escaping; decodeURI throws, and the router must
  // not take the whole render down over a hand-typed URL.
  assert.doesNotThrow(() => matchPath("/s/:token", "/s/%E0%A4%A"));
});

test("matchPath ignores leading and repeated slashes consistently", () => {
  const { matchPath } = paths;

  assert.deepEqual(matchPath("/documents", "/documents/"), {});
  assert.deepEqual(matchPath("/", "/"), {});
});
