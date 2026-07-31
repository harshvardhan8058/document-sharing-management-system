"use strict";

/**
 * Which documents a drop applies to.
 *
 * This exists because the bug it pins shipped: the collections list in the
 * sidebar could not see the library's selection, so dragging a highlighted group
 * of five documents onto a collection filed exactly one of them — silently, with
 * a success toast. The selection is now published to the shell, and the decision
 * itself lives here where it can be tested.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let dragPayload;

test.before(async () => {
  dragPayload = await import("../client/src/lib/dragPayload.js");
});

const payload = (ids) => JSON.stringify(ids);

test("dragging a card that is part of the selection carries the whole selection", () => {
  const { resolveDropIds } = dragPayload;

  assert.deepEqual(resolveDropIds(payload(["b"]), ["a", "b", "c"]), ["a", "b", "c"]);
});

test("dragging a card outside the selection moves only that card", () => {
  const { resolveDropIds } = dragPayload;

  // The file-manager convention: an unselected item does not adopt the selection.
  assert.deepEqual(resolveDropIds(payload(["z"]), ["a", "b"]), ["z"]);
});

test("a drag with no selection at all moves just the dragged card", () => {
  const { resolveDropIds } = dragPayload;

  assert.deepEqual(resolveDropIds(payload(["only"]), []), ["only"]);
  assert.deepEqual(resolveDropIds(payload(["only"])), ["only"]);
});

test("an explicit multi-id payload is honoured as-is", () => {
  const { resolveDropIds } = dragPayload;

  assert.deepEqual(resolveDropIds(payload(["a", "b"]), ["c"]), ["a", "b"]);
});

test("a drop with no payload falls back to the selection", () => {
  const { resolveDropIds } = dragPayload;

  // Dropping onto a collection while documents are selected should still work.
  assert.deepEqual(resolveDropIds("", ["a", "b"]), ["a", "b"]);
  assert.deepEqual(resolveDropIds(null, ["a"]), ["a"]);
  assert.deepEqual(resolveDropIds(undefined, []), []);
});

test("a payload from outside the app cannot throw or inject junk", () => {
  const { resolveDropIds } = dragPayload;

  // Plain text dragged in from another window.
  assert.deepEqual(resolveDropIds("Some document title", ["a"]), ["a"]);
  // Valid JSON of the wrong shape.
  assert.deepEqual(resolveDropIds('{"id":"a"}', ["b"]), ["b"]);
  // An array containing values that are not ids.
  assert.deepEqual(resolveDropIds(JSON.stringify(["good", null, 42, "", { id: 1 }]), []), ["good"]);
});

test("ids are de-duplicated so one document cannot be filed twice", () => {
  const { resolveDropIds } = dragPayload;

  assert.deepEqual(resolveDropIds(payload(["a", "a", "b"]), []), ["a", "b"]);
  assert.deepEqual(resolveDropIds(payload(["a"]), ["a", "b", "a"]), ["a", "b"]);
});

test("the drag MIME type is specific to this app", () => {
  const { DOCUMENT_DRAG_TYPE } = dragPayload;

  // A generic type would let any dragged text look like a document drop.
  assert.match(DOCUMENT_DRAG_TYPE, /^application\/x-dsms-/);
});
