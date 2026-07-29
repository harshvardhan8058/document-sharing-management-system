"use strict";

/**
 * The file-backed store: durability, the process lock, and the compare-and-swap
 * primitive that the share-link download cap depends on.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { openStore } = require("../server/data/local/store");

const COLLECTIONS = { things: {}, people: { uniqueKeys: ["email"] } };

async function withStore(run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dsms-store-"));
  const store = await openStore({ dir, collections: COLLECTIONS });
  try {
    await run(store, dir);
  } finally {
    await store.close().catch(() => {});
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("create assigns an ObjectId-shaped id and timestamps", async () => {
  await withStore(async (store) => {
    const created = await store.collections.things.create({ name: "first" });

    assert.match(created._id, /^[0-9a-f]{24}$/, "ids must be interchangeable with Mongo ObjectIds");
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(created.updatedAt, created.createdAt);
  });
});

test("reads return copies, so callers cannot mutate stored state", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    const created = await things.create({ name: "original", nested: { deep: 1 } });

    const fetched = await things.findById(created._id);
    fetched.name = "tampered";
    fetched.nested.deep = 999;

    const again = await things.findById(created._id);
    assert.equal(again.name, "original");
    assert.equal(again.nested.deep, 1);
  });
});

test("unique keys are enforced", async () => {
  await withStore(async (store) => {
    const people = store.collections.people;
    await people.create({ email: "a@example.com" });

    await assert.rejects(() => people.create({ email: "a@example.com" }), /already exists/);

    // A different address is fine, and so is updating the original in place.
    await people.create({ email: "b@example.com" });
    assert.equal(await people.count({}), 2);
  });
});

test("updateById patches, removes undefined keys, and refreshes updatedAt", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    const created = await things.create({ name: "a", scratch: "remove-me" });

    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = await things.updateById(created._id, { name: "b", scratch: undefined });

    assert.equal(updated.name, "b");
    assert.equal("scratch" in updated, false);
    assert.notEqual(updated.updatedAt, created.updatedAt);
    assert.equal(await things.updateById("does-not-exist", { name: "x" }), null);
  });
});

test("updateMany applies to every match and reports the count", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    await things.create({ name: "a", group: 1 });
    await things.create({ name: "b", group: 1 });
    await things.create({ name: "c", group: 2 });

    assert.equal(await things.updateMany({ group: 1 }, { flagged: true }), 2);
    assert.equal(await things.count({ flagged: true }), 2);
    assert.equal(await things.updateMany({ group: 99 }, { flagged: true }), 0);
  });
});

test("increment is atomic and can set companion fields in one step", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    const created = await things.create({ downloads: 0 });

    // Concurrent increments must not lose counts — this is the share-counter bug.
    await Promise.all(Array.from({ length: 50 }, () => things.increment(created._id, { downloads: 1 })));
    assert.equal((await things.findById(created._id)).downloads, 50);

    const withSet = await things.increment(created._id, { downloads: 1 }, { lastAccessedAt: "2026-01-01" });
    assert.equal(withSet.downloads, 51);
    assert.equal(withSet.lastAccessedAt, "2026-01-01");
  });
});

test("increment treats a missing or non-numeric field as zero", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    const created = await things.create({});
    assert.equal((await things.increment(created._id, { views: 1 })).views, 1);

    const junk = await things.create({ views: "not-a-number" });
    assert.equal((await things.increment(junk._id, { views: 2 })).views, 2);
  });
});

test("findOneAndIncrement only applies when the document still matches", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    const created = await things.create({ downloads: 0, cap: 3 });

    // The compare-and-swap succeeds against the value we read...
    const first = await things.findOneAndIncrement({ _id: created._id, downloads: 0 }, { downloads: 1 });
    assert.equal(first.downloads, 1);

    // ...and fails against a stale one, which is what makes the retry loop in
    // share.service safe.
    assert.equal(await things.findOneAndIncrement({ _id: created._id, downloads: 0 }, { downloads: 1 }), null);
    assert.equal((await things.findById(created._id)).downloads, 1, "a failed claim must not change anything");
  });
});

test("a download cap built on findOneAndIncrement is never exceeded", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    const cap = 5;
    const created = await things.create({ downloads: 0 });

    // Mirrors claimLinkDownload: read, check, claim, retry on contention.
    const claim = async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const current = await things.findById(created._id);
        if (current.downloads >= cap) return false;
        const won = await things.findOneAndIncrement(
          { _id: created._id, downloads: current.downloads },
          { downloads: 1 }
        );
        if (won) return true;
      }
      return false;
    };

    const results = await Promise.all(Array.from({ length: 40 }, claim));

    assert.equal(results.filter(Boolean).length, cap, "exactly the cap should be granted");
    assert.equal((await things.findById(created._id)).downloads, cap);
  });
});

test("find supports sorting, skipping and limiting", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    for (const size of [30, 10, 20, 40]) await things.create({ size });

    const page = await things.find({}, { sort: { size: 1 }, skip: 1, limit: 2 });
    assert.deepEqual(page.map((row) => row.size), [20, 30]);
  });
});

test("aggregate helpers cover the dashboard's needs", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    await things.create({ category: "pdf", size: 100, tags: ["a", "b"] });
    await things.create({ category: "pdf", size: 200, tags: ["b"] });
    await things.create({ category: "image", size: 300, tags: [] });

    assert.equal(await things.sum("size", {}), 600);
    assert.equal(await things.sum("size", { category: "pdf" }), 300);
    // Spread first: groupCount returns a null-prototype object on purpose, so a
    // key like "__proto__" in the data cannot pollute a prototype.
    assert.deepEqual({ ...(await things.groupCount("category", {})) }, { pdf: 2, image: 1 });
    assert.deepEqual((await things.distinct("tags", {})).sort(), ["a", "b"]);
  });
});

test("data survives a reopen, and a corrupt file is preserved rather than destroyed", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dsms-store-"));

  const first = await openStore({ dir, collections: COLLECTIONS });
  await first.collections.things.create({ name: "durable" });
  await first.close();

  const second = await openStore({ dir, collections: COLLECTIONS });
  assert.equal(await second.collections.things.count({}), 1);
  assert.equal((await second.collections.things.findOne({ name: "durable" })).name, "durable");
  await second.close();

  // Corrupt the file and confirm it is quarantined, not silently dropped.
  await fsp.writeFile(path.join(dir, "things.json"), "{ not json", "utf8");
  await assert.rejects(() => openStore({ dir, collections: COLLECTIONS }), /not valid JSON/);

  const salvaged = (await fsp.readdir(dir)).filter((name) => name.includes("corrupt"));
  assert.equal(salvaged.length, 1, "the unreadable file should be kept for inspection");

  await fsp.rm(dir, { recursive: true, force: true });
});

test("the lock stops a second process and is reclaimed when stale", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dsms-store-"));
  const store = await openStore({ dir, collections: COLLECTIONS });

  const lockFile = path.join(dir, ".lock");
  assert.equal(fs.existsSync(lockFile), true, "opening the store should take the lock");
  assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).pid, process.pid);

  // Pretend a different, still-running process holds it. PID 1 always exists.
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 1, since: new Date().toISOString() }));
  await assert.rejects(() => openStore({ dir, collections: COLLECTIONS }), /already in use by process 1/);

  // A dead owner's lock is taken over instead of blocking forever.
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, since: new Date().toISOString() }));
  const reclaimed = await openStore({ dir, collections: COLLECTIONS });
  assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).pid, process.pid);

  await reclaimed.close();
  assert.equal(fs.existsSync(lockFile), false, "closing should release the lock");

  await store.close().catch(() => {});
  await fsp.rm(dir, { recursive: true, force: true });
});

test("deleteMany removes only matching rows", async () => {
  await withStore(async (store) => {
    const things = store.collections.things;
    await things.create({ keep: true });
    await things.create({ keep: false });
    await things.create({ keep: false });

    assert.equal(await things.deleteMany({ keep: false }), 2);
    assert.equal(await things.count({}), 1);
    assert.equal(await things.deleteMany({ keep: "nothing-matches" }), 0);
  });
});
