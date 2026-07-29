"use strict";

const { toPublic, toPublicList } = require("../serialize");

/**
 * Adapt a {@link LocalCollection} to the repository surface used by services.
 * The collection already speaks the shared filter dialect, so this is a thin
 * `_id` -> `id` translation layer.
 */
function createLocalRepository(collection) {
  return {
    driver: "local",
    name: collection.name,

    create: async (input) => toPublic(await collection.create(input)),
    findById: async (id) => toPublic(await collection.findById(id)),
    findOne: async (filter) => toPublic(await collection.findOne(filter)),
    find: async (filter, options) => toPublicList(await collection.find(filter, options)),
    count: (filter) => collection.count(filter),
    updateById: async (id, patch) => toPublic(await collection.updateById(id, patch)),
    updateMany: (filter, patch) => collection.updateMany(filter, patch),
    increment: async (id, increments, set) => toPublic(await collection.increment(id, increments, set)),
    findOneAndIncrement: async (filter, increments, set) =>
      toPublic(await collection.findOneAndIncrement(filter, increments, set)),
    deleteById: (id) => collection.deleteById(id),
    deleteMany: (filter) => collection.deleteMany(filter),
    distinct: (field, filter) => collection.distinct(field, filter),
    sum: (field, filter) => collection.sum(field, filter),
    groupCount: (field, filter) => collection.groupCount(field, filter),
  };
}

module.exports = { createLocalRepository };
