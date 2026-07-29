"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { matches, sortComparator, translateFilter } = require("../filter");
const { newId } = require("../../utils/ids");
const ApiError = require("../../utils/ApiError");

/**
 * A dependency-free, file-backed collection.
 *
 * The whole point of this driver is that `npm start` works on a machine with no
 * database installed. Documents live in memory and are flushed to
 * `<dir>/<name>.json` after every mutation:
 *
 *  - writes are coalesced (many mutations in one tick cause one flush),
 *  - writes are serialised through a promise chain so two flushes never
 *    interleave,
 *  - writes go to a temp file and are then renamed, so a crash mid-write can
 *    never leave a half-written JSON file behind.
 */
class LocalCollection {
  /**
   * @param {string} name Collection name (also the filename)
   * @param {string} dir  Directory holding the JSON files
   * @param {{uniqueKeys?: string[]}} [options]
   */
  constructor(name, dir, options = {}) {
    this.name = name;
    this.file = path.join(dir, `${name}.json`);
    this.uniqueKeys = options.uniqueKeys || [];
    /** @type {Map<string, object>} */
    this.docs = new Map();
    this.flushQueue = Promise.resolve();
    this.flushScheduled = false;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      const raw = await fsp.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : parsed.records || [];
      for (const record of records) {
        if (record && record._id) this.docs.set(String(record._id), record);
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        // First boot: nothing persisted yet.
      } else if (err instanceof SyntaxError) {
        // Corrupt file: preserve it for inspection instead of destroying data.
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await fsp.rename(this.file, backup).catch(() => {});
        throw new Error(
          `Local database file ${this.file} is not valid JSON. It was moved to ${backup}.`
        );
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  /** Schedule a coalesced, atomic flush. */
  scheduleFlush() {
    if (this.flushScheduled) return this.flushQueue;
    this.flushScheduled = true;

    this.flushQueue = this.flushQueue.then(
      () =>
        new Promise((resolve, reject) => {
          setImmediate(async () => {
            this.flushScheduled = false;
            try {
              await this.writeNow();
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        })
    );
    return this.flushQueue;
  }

  async writeNow() {
    const payload = JSON.stringify(
      { collection: this.name, updatedAt: new Date().toISOString(), records: [...this.docs.values()] },
      null,
      2
    );
    const temp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, payload, "utf8");
    await fsp.rename(temp, this.file);
  }

  /** Wait for all pending writes to land on disk. */
  async drain() {
    await this.flushQueue;
    if (this.flushScheduled) await this.flushQueue;
  }

  // -- helpers -------------------------------------------------------------

  /** Deep clone so callers can never mutate the stored copy by accident. */
  static clone(doc) {
    return doc === undefined || doc === null ? doc : structuredClone(doc);
  }

  assertUnique(candidate, ignoreId = null) {
    for (const key of this.uniqueKeys) {
      const value = candidate[key];
      if (value === undefined || value === null) continue;
      for (const existing of this.docs.values()) {
        if (existing._id === ignoreId) continue;
        if (existing[key] === value) {
          throw ApiError.conflict(`A ${this.name.replace(/s$/, "")} with this ${key} already exists`, {
            code: "DUPLICATE_KEY",
            details: [{ field: key, value }],
          });
        }
      }
    }
  }

  // -- repository surface --------------------------------------------------

  async create(input) {
    const now = new Date().toISOString();
    const doc = {
      _id: input.id || input._id || newId(),
      ...LocalCollection.clone(input),
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    };
    delete doc.id;
    this.assertUnique(doc);
    this.docs.set(doc._id, doc);
    await this.scheduleFlush();
    return LocalCollection.clone(doc);
  }

  async findById(id) {
    if (typeof id !== "string") return null;
    return LocalCollection.clone(this.docs.get(id)) || null;
  }

  async findOne(filter = {}) {
    const query = translateFilter(filter);
    for (const doc of this.docs.values()) {
      if (matches(doc, query)) return LocalCollection.clone(doc);
    }
    return null;
  }

  async find(filter = {}, { sort, skip = 0, limit } = {}) {
    const query = translateFilter(filter);
    const found = [];
    for (const doc of this.docs.values()) {
      if (matches(doc, query)) found.push(doc);
    }
    if (sort) found.sort(sortComparator(sort));
    const sliced = limit === undefined ? found.slice(skip) : found.slice(skip, skip + limit);
    return sliced.map(LocalCollection.clone);
  }

  async count(filter = {}) {
    const query = translateFilter(filter);
    let total = 0;
    for (const doc of this.docs.values()) {
      if (matches(doc, query)) total += 1;
    }
    return total;
  }

  /**
   * Patch a document. Keys whose value is `undefined` are removed; everything
   * else is a shallow overwrite (matching `$set` semantics).
   */
  async updateById(id, patch = {}) {
    const current = this.docs.get(id);
    if (!current) return null;

    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "_id" || key === "id") continue;
      if (value === undefined) delete next[key];
      else next[key] = LocalCollection.clone(value);
    }
    next.updatedAt = new Date().toISOString();

    this.assertUnique(next, id);
    this.docs.set(id, next);
    await this.scheduleFlush();
    return LocalCollection.clone(next);
  }

  /**
   * Atomic-by-virtue-of-single-threadedness field increments.
   * Mirrors the mongo driver's `$inc` so counters behave the same either way.
   */
  async increment(id, increments = {}) {
    const current = this.docs.get(id);
    if (!current) return null;

    const next = { ...current };
    for (const [field, delta] of Object.entries(increments)) {
      const base = Number(next[field]);
      next[field] = (Number.isFinite(base) ? base : 0) + Number(delta || 0);
    }
    next.updatedAt = new Date().toISOString();

    this.docs.set(id, next);
    await this.scheduleFlush();
    return LocalCollection.clone(next);
  }

  async deleteById(id) {
    const existed = this.docs.delete(id);
    if (existed) await this.scheduleFlush();
    return existed;
  }

  async deleteMany(filter = {}) {
    const query = translateFilter(filter);
    let removed = 0;
    for (const [id, doc] of [...this.docs.entries()]) {
      if (matches(doc, query)) {
        this.docs.delete(id);
        removed += 1;
      }
    }
    if (removed) await this.scheduleFlush();
    return removed;
  }

  /** Distinct non-null values of `field` across matching documents. */
  async distinct(field, filter = {}) {
    const query = translateFilter(filter);
    const values = new Set();
    for (const doc of this.docs.values()) {
      if (!matches(doc, query)) continue;
      const value = doc[field];
      if (Array.isArray(value)) value.forEach((item) => item != null && values.add(item));
      else if (value != null) values.add(value);
    }
    return [...values];
  }

  /** Sum a numeric field across matching documents. */
  async sum(field, filter = {}) {
    const query = translateFilter(filter);
    let total = 0;
    for (const doc of this.docs.values()) {
      if (!matches(doc, query)) continue;
      const value = Number(doc[field]);
      if (Number.isFinite(value)) total += value;
    }
    return total;
  }

  /** `{ [value]: count }` grouped by `field`, over matching documents. */
  async groupCount(field, filter = {}) {
    const query = translateFilter(filter);
    const buckets = Object.create(null);
    for (const doc of this.docs.values()) {
      if (!matches(doc, query)) continue;
      const key = doc[field] == null ? "unknown" : String(doc[field]);
      buckets[key] = (buckets[key] || 0) + 1;
    }
    return buckets;
  }
}

/**
 * Open (creating if needed) the local database directory and its collections.
 * @param {{dir: string, collections: Record<string, {uniqueKeys?: string[]}>}} options
 */
async function openStore({ dir, collections }) {
  await fsp.mkdir(dir, { recursive: true });

  const opened = {};
  for (const [name, options] of Object.entries(collections)) {
    const collection = new LocalCollection(name, dir, options);
    await collection.load();
    opened[name] = collection;
  }

  return {
    dir,
    collections: opened,
    async drain() {
      await Promise.all(Object.values(opened).map((c) => c.drain()));
    },
    async close() {
      await this.drain();
    },
    /** Synchronous best-effort flush, used from process exit handlers. */
    flushSync() {
      for (const collection of Object.values(opened)) {
        try {
          fs.writeFileSync(
            collection.file,
            JSON.stringify(
              {
                collection: collection.name,
                updatedAt: new Date().toISOString(),
                records: [...collection.docs.values()],
              },
              null,
              2
            ),
            "utf8"
          );
        } catch {
          /* best effort */
        }
      }
    },
  };
}

module.exports = { openStore, LocalCollection };
