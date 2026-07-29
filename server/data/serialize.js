"use strict";

/**
 * Storage records use `_id`; the rest of the application (and the HTTP API)
 * uses `id`. Both drivers funnel their output through here so callers cannot
 * tell which one is active.
 */
function toPublic(record) {
  if (!record) return null;
  const { _id, __v, ...rest } = record;
  return { id: String(_id), ...rest };
}

function toPublicList(records) {
  return (records || []).map(toPublic);
}

module.exports = { toPublic, toPublicList };
