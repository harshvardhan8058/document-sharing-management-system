"use strict";

/**
 * The shared query dialect.
 *
 * Both drivers are handed the same filter objects: MongoDB evaluates them
 * natively, the local driver evaluates them with `matches()`. Any behavioural
 * difference between the two shows up as a permission or listing bug, so these
 * tests pin the semantics the local matcher must reproduce.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { matches, translateFilter, sortComparator } = require("../server/data/filter");

const doc = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  title: "Migration Plan",
  ownerId: "owner-1",
  status: "active",
  visibility: "internal",
  size: 2048,
  tags: ["migration", "platform"],
  starredBy: ["user-1", "user-2"],
  createdAt: "2026-03-01T10:00:00.000Z",
  trashedAt: null,
  versions: [{ version: 1, size: 1024 }],
};

test("an empty filter matches everything", () => {
  assert.equal(matches(doc, {}), true);
  assert.equal(matches(doc, undefined), true);
  assert.equal(matches(doc, null), true);
});

test("scalar equality", () => {
  assert.equal(matches(doc, { status: "active" }), true);
  assert.equal(matches(doc, { status: "trashed" }), false);
  assert.equal(matches(doc, { status: "active", ownerId: "owner-1" }), true);
  assert.equal(matches(doc, { status: "active", ownerId: "someone-else" }), false);
});

test("a scalar matches any element of an array field, as MongoDB does", () => {
  // This is what makes `{ tags: "platform" }` and `{ starredBy: userId }` work.
  assert.equal(matches(doc, { tags: "platform" }), true);
  assert.equal(matches(doc, { tags: "missing" }), false);
  assert.equal(matches(doc, { starredBy: "user-2" }), true);
  assert.equal(matches(doc, { starredBy: "user-9" }), false);
});

test("comparison operators", () => {
  assert.equal(matches(doc, { size: { $gt: 1024 } }), true);
  assert.equal(matches(doc, { size: { $gt: 2048 } }), false);
  assert.equal(matches(doc, { size: { $gte: 2048 } }), true);
  assert.equal(matches(doc, { size: { $lt: 4096 } }), true);
  assert.equal(matches(doc, { size: { $lte: 2048 } }), true);
  assert.equal(matches(doc, { size: { $ne: 1 } }), true);
  assert.equal(matches(doc, { size: { $ne: 2048 } }), false);
});

test("$lt and $lte treat a missing field as no match, not as zero", () => {
  // The trash sweep filters on `trashedAt: { $lt: cutoff }`. If a null or
  // absent timestamp compared as "less than", the sweep would delete live
  // documents.
  assert.equal(matches(doc, { trashedAt: { $lt: "2026-01-01T00:00:00.000Z" } }), false);
  assert.equal(matches({ ...doc, trashedAt: undefined }, { trashedAt: { $lt: "2030-01-01" } }), false);
  assert.equal(matches({ ...doc, trashedAt: "2026-01-01T00:00:00.000Z" }, { trashedAt: { $lt: "2026-02-01" } }), true);
});

test("$in and $nin", () => {
  assert.equal(matches(doc, { visibility: { $in: ["internal", "public"] } }), true);
  assert.equal(matches(doc, { visibility: { $in: ["public"] } }), false);
  assert.equal(matches(doc, { visibility: { $nin: ["public"] } }), true);
  assert.equal(matches(doc, { _id: { $in: [doc._id, "other"] } }), true);
  assert.equal(matches(doc, { _id: { $in: [] } }), false);
});

test("$in works against array fields too", () => {
  assert.equal(matches(doc, { tags: { $in: ["platform", "nope"] } }), true);
  assert.equal(matches(doc, { tags: { $in: ["nope"] } }), false);
});

test("$all requires every value to be present", () => {
  assert.equal(matches(doc, { tags: { $all: ["migration", "platform"] } }), true);
  assert.equal(matches(doc, { tags: { $all: ["migration", "absent"] } }), false);
});

test("$regex with the i option", () => {
  assert.equal(matches(doc, { title: { $regex: "migration", $options: "i" } }), true);
  assert.equal(matches(doc, { title: { $regex: "migration" } }), false, "case sensitive without the option");
  assert.equal(matches(doc, { title: { $regex: "^Migration" } }), true);
  assert.equal(matches(doc, { tags: { $regex: "plat", $options: "i" } }), true, "regex applies across array elements");
});

test("$exists distinguishes present from null", () => {
  assert.equal(matches(doc, { title: { $exists: true } }), true);
  assert.equal(matches(doc, { nope: { $exists: false } }), true);
  assert.equal(matches(doc, { trashedAt: { $exists: false } }), true, "null counts as absent");
  assert.equal(matches(doc, { trashedAt: { $exists: true } }), false);
});

test("$or, $and and $nor", () => {
  assert.equal(matches(doc, { $or: [{ ownerId: "nobody" }, { visibility: "internal" }] }), true);
  assert.equal(matches(doc, { $or: [{ ownerId: "nobody" }, { visibility: "public" }] }), false);
  assert.equal(matches(doc, { $and: [{ status: "active" }, { size: { $gte: 1 } }] }), true);
  assert.equal(matches(doc, { $and: [{ status: "active" }, { size: { $gte: 99999 } }] }), false);
  assert.equal(matches(doc, { $nor: [{ status: "trashed" }] }), true);
});

test("the real accessibility clause behaves correctly", () => {
  // Exactly the shape document.service builds for scope=starred: a bookmark
  // filter intersected with what the caller may see.
  const clause = {
    $and: [
      { starredBy: "user-1" },
      {
        status: "active",
        $or: [
          { ownerId: "someone-else" },
          { _id: { $in: [] } },
          { visibility: { $in: ["internal", "public"] } },
        ],
      },
    ],
  };

  assert.equal(matches(doc, clause), true, "internal visibility grants access");

  // Once the owner makes it private, the same starred bookmark must not match.
  const madePrivate = { ...doc, visibility: "private" };
  assert.equal(matches(madePrivate, clause), false, "this is the starred-scope leak regression");
});

test("translateFilter rewrites id to _id at every depth", () => {
  assert.deepEqual(translateFilter({ id: "x" }), { _id: "x" });
  assert.deepEqual(translateFilter({ id: { $in: ["a", "b"] } }), { _id: { $in: ["a", "b"] } });
  assert.deepEqual(translateFilter({ $or: [{ id: "a" }, { ownerId: "b" }] }), {
    $or: [{ _id: "a" }, { ownerId: "b" }],
  });
  assert.deepEqual(translateFilter({ $and: [{ id: "a" }, { $or: [{ id: "b" }] }] }), {
    $and: [{ _id: "a" }, { $or: [{ _id: "b" }] }],
  });
  // Other fields are untouched.
  assert.deepEqual(translateFilter({ documentId: "d" }), { documentId: "d" });
});

test("dotted paths reach into nested objects", () => {
  const nested = { _id: "1", file: { size: 500, name: "a.pdf" } };
  assert.equal(matches(nested, { "file.size": 500 }), true);
  assert.equal(matches(nested, { "file.size": { $gt: 100 } }), true);
  assert.equal(matches(nested, { "file.name": "a.pdf" }), true);
  assert.equal(matches(nested, { "file.missing": { $exists: false } }), true);
});

test("an unsupported operator fails loudly rather than matching nothing", () => {
  // Silently returning false would make a filter look like "no results" instead
  // of a programming error.
  assert.throws(() => matches(doc, { size: { $bogus: 1 } }), /Unsupported query operator/);
});

test("sortComparator orders by direction and falls back to _id for stability", () => {
  const rows = [
    { _id: "c", title: "beta", size: 10 },
    { _id: "a", title: "alpha", size: 30 },
    { _id: "b", title: "alpha", size: 20 },
  ];

  assert.deepEqual(
    [...rows].sort(sortComparator({ size: -1 })).map((r) => r._id),
    ["a", "b", "c"]
  );
  assert.deepEqual(
    [...rows].sort(sortComparator({ size: 1 })).map((r) => r._id),
    ["c", "b", "a"]
  );
  // Equal titles must resolve deterministically, otherwise pagination can drop
  // or repeat rows between pages.
  assert.deepEqual(
    [...rows].sort(sortComparator({ title: 1 })).map((r) => r._id),
    ["a", "b", "c"]
  );
});

test("string sorting is natural and case insensitive", () => {
  const rows = [{ _id: "1", title: "item10" }, { _id: "2", title: "Item2" }];
  assert.deepEqual(
    [...rows].sort(sortComparator({ title: 1 })).map((r) => r.title),
    ["Item2", "item10"]
  );
});
