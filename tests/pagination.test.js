"use strict";

/**
 * Sort orders offered by the API.
 *
 * A sortable table column needs both directions, and every order needs a
 * tie-breaker: without one, ordering by a field that has duplicates is
 * non-deterministic, so paging through equal values can show a row twice and
 * skip another. The local store's comparator already fell back to `_id`;
 * MongoDB does not, so the two drivers could answer the same request with
 * different pages.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { SORT_OPTIONS, readSort } = require("../server/utils/pagination");

test("every sort order ends with an _id tie-breaker", () => {
  for (const [name, spec] of Object.entries(SORT_OPTIONS)) {
    const keys = Object.keys(spec);
    assert.ok(keys.length >= 2, `${name} has no tie-breaker`);
    assert.equal(keys.at(-1), "_id", `${name} does not end with _id`);
  }
});

test("the tie-breaker follows the primary direction", () => {
  // Otherwise "newest first" would flip to oldest-first among equal timestamps.
  for (const [name, spec] of Object.entries(SORT_OPTIONS)) {
    const [, primaryDirection] = Object.entries(spec)[0];
    assert.equal(spec._id, primaryDirection, `${name} tie-breaks against its own direction`);
  }
});

test("every sortable column can be sorted both ways", () => {
  // A column header that only sorts one way is a trap: the second click has to
  // do something, and reverting to the default order is not what it looks like.
  const pairs = [
    ["newest", "oldest"], // created
    ["updated", "updated-asc"],
    ["name", "name-desc"],
    ["largest", "smallest"], // size
    ["downloads", "downloads-asc"],
  ];

  for (const [descending, ascending] of pairs) {
    assert.ok(SORT_OPTIONS[descending], `missing ${descending}`);
    assert.ok(SORT_OPTIONS[ascending], `missing ${ascending}`);

    const [[descField, descDir]] = Object.entries(SORT_OPTIONS[descending]);
    const [[ascField, ascDir]] = Object.entries(SORT_OPTIONS[ascending]);

    assert.equal(descField, ascField, `${descending}/${ascending} sort different fields`);
    assert.equal(descDir, -ascDir, `${descending}/${ascending} are not opposites`);
  }
});

test("an unknown or missing sort falls back to the default", () => {
  assert.deepEqual(readSort("nonsense"), SORT_OPTIONS.newest);
  assert.deepEqual(readSort(undefined), SORT_OPTIONS.newest);
  assert.deepEqual(readSort(""), SORT_OPTIONS.newest);
  // A caller can choose a different fallback.
  assert.deepEqual(readSort("nonsense", "name"), SORT_OPTIONS.name);
  // And a valid value is honoured.
  assert.deepEqual(readSort("largest"), SORT_OPTIONS.largest);
});

test("the local comparator agrees with the declared order", async () => {
  const { sortComparator } = require("../server/data/filter");

  const rows = [
    { _id: "c", size: 10, title: "b" },
    { _id: "a", size: 10, title: "a" },
    { _id: "b", size: 30, title: "c" },
  ];

  // Equal sizes fall back to _id, in the primary direction.
  assert.deepEqual(
    [...rows].sort(sortComparator(SORT_OPTIONS.largest)).map((row) => row._id),
    ["b", "c", "a"]
  );
  assert.deepEqual(
    [...rows].sort(sortComparator(SORT_OPTIONS.smallest)).map((row) => row._id),
    ["a", "c", "b"]
  );
  assert.deepEqual(
    [...rows].sort(sortComparator(SORT_OPTIONS.name)).map((row) => row._id),
    ["a", "c", "b"]
  );
});
