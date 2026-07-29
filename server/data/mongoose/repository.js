"use strict";

const { translateFilter } = require("../filter");
const { toPublic, toPublicList } = require("../serialize");
const ApiError = require("../../utils/ApiError");

/** Turn a Mongo duplicate-key error into a client-safe 409. */
function rethrow(err, collectionName) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || { field: 1 })[0];
    throw ApiError.conflict(
      `A ${collectionName.replace(/s$/, "")} with this ${field} already exists`,
      { code: "DUPLICATE_KEY", details: [{ field }] }
    );
  }
  if (err && err.name === "ValidationError") {
    throw ApiError.unprocessable("Record failed schema validation", {
      code: "SCHEMA_VALIDATION",
      details: Object.entries(err.errors || {}).map(([field, e]) => ({ field, message: e.message })),
    });
  }
  throw err;
}

/**
 * Split a patch into `$set` / `$unset`, mirroring the local driver's rule that
 * an explicit `undefined` removes the field.
 */
function buildUpdate(patch = {}) {
  const $set = {};
  const $unset = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "_id" || key === "id") continue;
    if (value === undefined) $unset[key] = "";
    else $set[key] = value;
  }
  $set.updatedAt = new Date().toISOString();

  const update = { $set };
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

/**
 * Adapt a Mongoose model to the repository surface used by services.
 * Every read uses `.lean()` — services want plain data, not hydrated documents.
 */
function createMongooseRepository(model) {
  const name = model.collection.name;

  return {
    driver: "mongo",
    name,

    async create(input) {
      const now = new Date().toISOString();
      const payload = { ...input, createdAt: input.createdAt || now, updatedAt: input.updatedAt || now };
      if (payload.id) {
        payload._id = payload.id;
        delete payload.id;
      }
      try {
        const created = await model.create(payload);
        return toPublic(created.toObject());
      } catch (err) {
        return rethrow(err, name);
      }
    },

    async findById(id) {
      if (typeof id !== "string") return null;
      return toPublic(await model.findById(id).lean());
    },

    async findOne(filter = {}) {
      return toPublic(await model.findOne(translateFilter(filter)).lean());
    },

    async find(filter = {}, { sort, skip = 0, limit } = {}) {
      let query = model.find(translateFilter(filter));
      if (sort) query = query.sort(sort);
      if (skip) query = query.skip(skip);
      if (limit !== undefined) query = query.limit(limit);
      return toPublicList(await query.lean());
    },

    count(filter = {}) {
      return model.countDocuments(translateFilter(filter));
    },

    async updateById(id, patch = {}) {
      try {
        const updated = await model
          .findByIdAndUpdate(id, buildUpdate(patch), { new: true, runValidators: true })
          .lean();
        return toPublic(updated);
      } catch (err) {
        return rethrow(err, name);
      }
    },

    /**
     * Atomic field increments — a read-modify-write would lose counts under
     * concurrent downloads.
     */
    async increment(id, increments = {}) {
      const updated = await model
        .findByIdAndUpdate(
          id,
          { $inc: increments, $set: { updatedAt: new Date().toISOString() } },
          { new: true }
        )
        .lean();
      return toPublic(updated);
    },

    async deleteById(id) {
      const result = await model.deleteOne({ _id: id });
      return result.deletedCount > 0;
    },

    async deleteMany(filter = {}) {
      const result = await model.deleteMany(translateFilter(filter));
      return result.deletedCount || 0;
    },

    async distinct(field, filter = {}) {
      const values = await model.distinct(field, translateFilter(filter));
      return values.filter((value) => value !== null && value !== undefined);
    },

    async sum(field, filter = {}) {
      const [row] = await model.aggregate([
        { $match: translateFilter(filter) },
        { $group: { _id: null, total: { $sum: `$${field}` } } },
      ]);
      return row ? row.total : 0;
    },

    async groupCount(field, filter = {}) {
      const rows = await model.aggregate([
        { $match: translateFilter(filter) },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      ]);
      const buckets = Object.create(null);
      for (const row of rows) {
        buckets[row._id == null ? "unknown" : String(row._id)] = row.count;
      }
      return buckets;
    },
  };
}

module.exports = { createMongooseRepository };
