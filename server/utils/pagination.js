"use strict";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/**
 * Normalise `?page=` / `?limit=` into safe numbers.
 * Out-of-range and non-numeric input is clamped rather than rejected.
 */
function readPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.limit, 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

/** Build the pagination envelope returned alongside list results. */
function buildMeta({ page, limit, total }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    pages,
    hasNext: page < pages,
    hasPrevious: page > 1,
  };
}

/**
 * Translate a whitelisted `?sort=` value into a driver-agnostic sort object.
 * Unknown values fall back to newest-first instead of erroring.
 */
/**
 * Sort orders the API will accept, each with an explicit `_id` tie-breaker.
 *
 * Two reasons for the tie-breaker, and both bite in practice:
 *
 * 1. Ordering by a field with duplicates is not deterministic on its own. Five
 *    documents seeded in the same second, or any two files of the same size,
 *    can come back in a different order for each query — so paging through them
 *    is free to show one row twice and skip another.
 * 2. The two drivers disagreed without it. The local store's comparator already
 *    falls back to `_id`; MongoDB makes no such promise. Same request, same
 *    data, different page.
 *
 * The tie-breaker follows the primary direction so "newest first" stays
 * newest-first among equal timestamps.
 */
const SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  name: { title: 1, _id: 1 },
  "name-desc": { title: -1, _id: -1 },
  largest: { size: -1, _id: -1 },
  smallest: { size: 1, _id: 1 },
  downloads: { downloadCount: -1, _id: -1 },
  "downloads-asc": { downloadCount: 1, _id: 1 },
  updated: { updatedAt: -1, _id: -1 },
  "updated-asc": { updatedAt: 1, _id: 1 },
};

function readSort(value, fallback = "newest") {
  return SORT_OPTIONS[value] || SORT_OPTIONS[fallback];
}

module.exports = { readPagination, buildMeta, readSort, SORT_OPTIONS, DEFAULT_LIMIT, MAX_LIMIT };
