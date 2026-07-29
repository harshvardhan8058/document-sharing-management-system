"use strict";

/**
 * A small, shared query dialect.
 *
 * Services speak one filter language; the mongo driver passes it straight to
 * MongoDB, and the local driver evaluates it in-process with the matcher below.
 * Only the operators the application actually uses are supported — anything
 * else throws loudly rather than silently matching nothing.
 */

const SUPPORTED_OPERATORS = new Set([
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte",
  "$in", "$nin", "$all", "$regex", "$options", "$exists", "$not",
]);

/**
 * Rewrite the public `id` field to the storage-level `_id`, recursively.
 * Lets callers write `{ id: x }` while both drivers store `_id`.
 */
function translateFilter(filter) {
  if (Array.isArray(filter)) return filter.map(translateFilter);
  if (filter === null || typeof filter !== "object" || filter instanceof Date || filter instanceof RegExp) {
    return filter;
  }

  const out = {};
  for (const [key, value] of Object.entries(filter)) {
    const mappedKey = key === "id" ? "_id" : key;
    if (key === "$or" || key === "$and" || key === "$nor") {
      out[key] = (Array.isArray(value) ? value : [value]).map(translateFilter);
    } else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp)) {
      out[mappedKey] = translateFilter(value);
    } else {
      out[mappedKey] = value;
    }
  }
  return out;
}

/** Resolve a possibly dotted path such as `file.size`. */
function readPath(doc, path) {
  if (!path.includes(".")) return doc == null ? undefined : doc[path];
  return path.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), doc);
}

/** Comparable primitive — dates collapse to their numeric time. */
function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    // ISO date strings sort correctly lexicographically, so leave them alone.
    return value;
  }
  return value;
}

function looseCompare(a, b) {
  const left = comparable(a);
  const right = comparable(b);
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }
  return left < right ? -1 : 1;
}

function valuesEqual(a, b) {
  const left = comparable(a);
  const right = comparable(b);
  if (left instanceof Object || right instanceof Object) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

/**
 * Mongo-style equality: when the stored field is an array, a scalar condition
 * matches if *any* element matches.
 */
function fieldEquals(actual, expected) {
  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.some((item) => valuesEqual(item, expected));
  }
  return valuesEqual(actual, expected);
}

function toRegExp(pattern, options) {
  if (pattern instanceof RegExp) return pattern;
  return new RegExp(pattern, options || "");
}

function matchOperators(actual, condition) {
  for (const [operator, expected] of Object.entries(condition)) {
    if (operator === "$options") continue; // consumed together with $regex

    if (!SUPPORTED_OPERATORS.has(operator)) {
      throw new Error(`Unsupported query operator "${operator}" in local database driver`);
    }

    switch (operator) {
      case "$eq":
        if (!fieldEquals(actual, expected)) return false;
        break;
      case "$ne":
        if (fieldEquals(actual, expected)) return false;
        break;
      case "$gt":
        if (!(looseCompare(actual, expected) > 0)) return false;
        break;
      case "$gte":
        if (!(looseCompare(actual, expected) >= 0)) return false;
        break;
      case "$lt":
        if (actual === undefined || actual === null) return false;
        if (!(looseCompare(actual, expected) < 0)) return false;
        break;
      case "$lte":
        if (actual === undefined || actual === null) return false;
        if (!(looseCompare(actual, expected) <= 0)) return false;
        break;
      case "$in":
        if (!expected.some((candidate) => fieldEquals(actual, candidate))) return false;
        break;
      case "$nin":
        if (expected.some((candidate) => fieldEquals(actual, candidate))) return false;
        break;
      case "$all":
        if (!Array.isArray(actual)) return false;
        if (!expected.every((candidate) => actual.some((item) => valuesEqual(item, candidate)))) return false;
        break;
      case "$regex": {
        const regex = toRegExp(expected, condition.$options);
        const haystack = Array.isArray(actual) ? actual : [actual];
        if (!haystack.some((item) => typeof item === "string" && regex.test(item))) return false;
        break;
      }
      case "$exists": {
        const present = actual !== undefined && actual !== null;
        if (present !== Boolean(expected)) return false;
        break;
      }
      case "$not":
        if (matchOperators(actual, expected)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** True when `doc` satisfies `filter`. An empty filter matches everything. */
function matches(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      if (!condition.some((sub) => matches(doc, sub))) return false;
      continue;
    }
    if (key === "$and") {
      if (!condition.every((sub) => matches(doc, sub))) return false;
      continue;
    }
    if (key === "$nor") {
      if (condition.some((sub) => matches(doc, sub))) return false;
      continue;
    }

    const actual = readPath(doc, key);
    const isOperatorObject =
      condition !== null &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      !(condition instanceof Date) &&
      !(condition instanceof RegExp) &&
      Object.keys(condition).some((k) => k.startsWith("$"));

    if (isOperatorObject) {
      if (!matchOperators(actual, condition)) return false;
    } else if (condition instanceof RegExp) {
      if (!matchOperators(actual, { $regex: condition })) return false;
    } else if (!fieldEquals(actual, condition)) {
      return false;
    }
  }
  return true;
}

/**
 * Build an Array#sort comparator from a `{ field: 1 | -1 }` spec.
 * `_id` is appended as a tiebreaker so paging is stable.
 */
function sortComparator(sort = {}) {
  const keys = Object.entries(sort);
  return (a, b) => {
    for (const [field, direction] of keys) {
      const result = looseCompare(readPath(a, field), readPath(b, field));
      if (result !== 0) return direction < 0 ? -result : result;
    }
    return looseCompare(a._id, b._id);
  };
}

module.exports = { translateFilter, matches, sortComparator, readPath, looseCompare };
