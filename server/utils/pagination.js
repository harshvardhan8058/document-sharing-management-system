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
const SORT_OPTIONS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { title: 1 },
  "name-desc": { title: -1 },
  largest: { size: -1 },
  smallest: { size: 1 },
  downloads: { downloadCount: -1 },
  updated: { updatedAt: -1 },
};

function readSort(value, fallback = "newest") {
  return SORT_OPTIONS[value] || SORT_OPTIONS[fallback];
}

module.exports = { readPagination, buildMeta, readSort, SORT_OPTIONS, DEFAULT_LIMIT, MAX_LIMIT };
