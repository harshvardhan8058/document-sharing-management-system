"use strict";

/**
 * The line diff behind version comparison.
 *
 * Worth testing properly because a diff that is subtly wrong is worse than no
 * diff: it will confidently tell you a line changed when it moved, and the
 * reader has no way to know. The awkward cases here are the ones real documents
 * produce — an edit in the middle of an otherwise identical file, a file that
 * gained a trailing newline, and a file rewritten on another operating system.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let diff;

test.before(async () => {
  diff = await import("../client/src/lib/diff.js");
});

const types = (rows) => rows.map((row) => row.type).join(",");
const texts = (rows, type) => rows.filter((row) => row.type === type).map((row) => row.text);

test("identical text produces no changes", () => {
  const { diffLines } = diff;
  const result = diffLines("one\ntwo\nthree", "one\ntwo\nthree");

  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
  assert.equal(types(result.rows), "equal,equal,equal");
});

test("a changed line reads as one removal and one addition", () => {
  const { diffLines } = diff;
  const result = diffLines("one\ntwo\nthree", "one\nTWO\nthree");

  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.deepEqual(texts(result.rows, "remove"), ["two"]);
  assert.deepEqual(texts(result.rows, "add"), ["TWO"]);
});

test("an inserted line is not reported as a rewrite of the lines after it", () => {
  const { diffLines } = diff;
  // The naive comparison — pairing line 2 with line 2, line 3 with line 3 —
  // marks everything after the insertion as changed. This is the whole reason
  // the alignment step exists.
  const result = diffLines("a\nb\nc", "a\nNEW\nb\nc");

  assert.equal(result.added, 1);
  assert.equal(result.removed, 0);
  assert.deepEqual(texts(result.rows, "add"), ["NEW"]);
});

test("line numbers point at the right side of the comparison", () => {
  const { diffLines } = diff;
  const { rows } = diffLines("a\nb", "a\nNEW\nb");

  const added = rows.find((row) => row.type === "add");
  assert.equal(added.before, null, "an added line does not exist in the old version");
  assert.equal(typeof added.after, "number");

  const removed = diffLines("a\nGONE\nb", "a\nb").rows.find((row) => row.type === "remove");
  assert.equal(removed.after, null, "a removed line does not exist in the new version");
  assert.equal(removed.before, 2);
});

test("an empty document on either side is handled", () => {
  const { diffLines } = diff;

  assert.equal(diffLines("", "").rows.length, 0);
  assert.equal(diffLines("", "new\nlines").added, 2);
  assert.equal(diffLines("old\nlines", "").removed, 2);
});

test("line endings are normalised, so a Windows edit is not a total rewrite", () => {
  const { diffLines } = diff;

  const result = diffLines("one\ntwo\nthree", "one\r\ntwo\r\nthree");
  assert.equal(result.added, 0, "CRLF alone must not register as a change");
  assert.equal(result.removed, 0);

  // A real change inside CRLF text is still found.
  const changed = diffLines("one\r\ntwo", "one\r\nTWO");
  assert.equal(changed.added, 1);
  assert.equal(changed.removed, 1);
});

test("a trailing newline is a change, because it is one", () => {
  const { diffLines } = diff;
  const result = diffLines("text", "text\n");

  // The second version has an empty final line. Reporting nothing would hide a
  // real difference in the bytes.
  assert.equal(result.added, 1);
  assert.deepEqual(texts(result.rows, "add"), [""]);
});

test("a file far too large to align degrades instead of hanging", () => {
  const { diffLines } = diff;

  // Two thousand entirely different lines on each side: past the quadratic
  // ceiling, so it reports the span as replaced rather than pairing lines.
  const before = Array.from({ length: 2000 }, (_, index) => `old ${index}`).join("\n");
  const after = Array.from({ length: 2000 }, (_, index) => `new ${index}`).join("\n");

  const started = Date.now();
  const result = diffLines(before, after);
  const elapsed = Date.now() - started;

  assert.equal(result.truncated, true);
  assert.equal(result.removed, 2000);
  assert.equal(result.added, 2000);
  assert.ok(elapsed < 2000, `degraded path took ${elapsed}ms`);
});

test("a large file with a small edit is still aligned precisely", () => {
  const { diffLines } = diff;

  // Only the middle differs, so trimming the shared head and tail brings this
  // well under the ceiling even though the file is long.
  const lines = Array.from({ length: 5000 }, (_, index) => `line ${index}`);
  const before = lines.join("\n");
  const edited = [...lines];
  edited[2500] = "line 2500 — edited";
  const after = edited.join("\n");

  const result = diffLines(before, after);
  assert.equal(result.truncated, false, "shared ends should have been trimmed");
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
});

test("hunks keep context around each change and skip the rest", () => {
  const { diffLines, toHunks } = diff;

  const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 20", "line 20 changed");

  const { rows } = diffLines(before, after);
  const hunks = toHunks(rows, 3);

  assert.equal(hunks.length, 1, "one edit, one hunk");
  // Three lines of context either side, plus the removal and the addition.
  assert.equal(hunks[0].rows.length, 8);
  assert.ok(
    hunks[0].rows.some((row) => row.text === "line 20 changed"),
    "the change itself is in the hunk"
  );
  assert.ok(hunks[0].skippedBefore > 0, "and it records how much it skipped to get there");
});

test("separate edits produce separate hunks", () => {
  const { diffLines, toHunks } = diff;

  const before = Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 5", "line 5 changed").replace("line 50", "line 50 changed");

  const hunks = toHunks(diffLines(before, after).rows, 2);
  assert.equal(hunks.length, 2);
});

test("no changes means no hunks at all", () => {
  const { diffLines, toHunks } = diff;

  const text = "a\nb\nc";
  assert.deepEqual(toHunks(diffLines(text, text).rows, 3), []);
});
