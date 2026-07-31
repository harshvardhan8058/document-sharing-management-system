"use strict";

/**
 * Presentation helpers that are easy to get subtly wrong.
 *
 * `formatUsagePercent` exists because the storage gauge rendered "0.0%" for a
 * real 2.6 KB of usage. That is arithmetically correct and completely
 * misleading: on a demo instance every number on the dashboard was zero, so a
 * true value looked like a failed render.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let format;

test.before(async () => {
  format = await import("../client/src/lib/format.js");
});

test("an empty quota reads as a flat zero", () => {
  const { formatUsagePercent } = format;

  assert.equal(formatUsagePercent(0), "0%");
  assert.equal(formatUsagePercent(0, 0), "0%");
});

test("a tiny but real amount is never reported as zero", () => {
  const { formatUsagePercent } = format;

  // 2.6 KB of a 2 GB quota, the seeded case that started this.
  assert.equal(formatUsagePercent(0.000121), "<0.1%");
  assert.equal(formatUsagePercent(0.05), "<0.1%");
  assert.equal(formatUsagePercent(0.0999), "<0.1%");
});

test("ordinary values keep one decimal until they no longer need it", () => {
  const { formatUsagePercent } = format;

  assert.equal(formatUsagePercent(0.1, 0.1), "0.1%");
  assert.equal(formatUsagePercent(4.25, 4.25), "4.3%");
  assert.equal(formatUsagePercent(9.94, 9.94), "9.9%");
  // Past ten percent the decimal is noise on a gauge this size.
  assert.equal(formatUsagePercent(10, 10), "10%");
  assert.equal(formatUsagePercent(87.6, 87.6), "88%");
  assert.equal(formatUsagePercent(100, 100), "100%");
});

test("the animated value is what gets displayed, clamped to the target", () => {
  const { formatUsagePercent } = format;

  // Mid-animation the gauge is somewhere below its target. The displayed value
  // follows the same decimal rule as any other, so 12.5 loses its decimal.
  assert.equal(formatUsagePercent(60, 12.5), "13%");
  assert.equal(formatUsagePercent(60, 4.25), "4.3%");
  // Easing that overshoots must not print more than the truth.
  assert.equal(formatUsagePercent(60, 61.4), "60%");
  // A negative frame cannot print a negative percentage.
  assert.equal(formatUsagePercent(60, -3), "0.0%");
});

test("nonsense input degrades to zero instead of NaN", () => {
  const { formatUsagePercent } = format;

  assert.equal(formatUsagePercent(Number.NaN), "0%");
  assert.equal(formatUsagePercent(undefined), "0%");
  assert.equal(formatUsagePercent(-5), "0%");
  // A broken animation frame falls back to the real value.
  assert.equal(formatUsagePercent(42, Number.NaN), "42%");
});


test("what counts as a text document is decided in one place", () => {
  const { isTextDocument } = format;

  /*
   * The preview and version comparison both ask this question. They used to ask
   * it separately — the preview with its own regex — which left them free to
   * disagree: a file could render as text and then refuse to diff.
   */
  const doc = (mimeType) => ({ file: { mimeType } });

  assert.equal(isTextDocument(doc("text/plain")), true);
  assert.equal(isTextDocument(doc("text/markdown")), true);
  assert.equal(isTextDocument(doc("text/csv")), true);
  // Text that browsers label as application/*.
  assert.equal(isTextDocument(doc("application/json")), true);
  assert.equal(isTextDocument(doc("application/xml")), true);
  assert.equal(isTextDocument(doc("image/svg+xml")), true, "SVG is XML, and readable as text");

  assert.equal(isTextDocument(doc("application/pdf")), false);
  assert.equal(isTextDocument(doc("image/png")), false);
  assert.equal(isTextDocument(doc("application/zip")), false);
  // A .docx is a zip container, not text, however much it holds words.
  assert.equal(
    isTextDocument(doc("application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
    false
  );

  // Missing or malformed input must answer "no", not throw.
  assert.equal(isTextDocument(undefined), false);
  assert.equal(isTextDocument({}), false);
  assert.equal(isTextDocument({ file: {} }), false);
  // Accepts a bare shape too, since some call sites hold the file, not the document.
  assert.equal(isTextDocument({ mimeType: "text/plain" }), true);
});
