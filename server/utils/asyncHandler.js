"use strict";

/**
 * Wraps an async route handler so rejected promises reach Express' error
 * middleware instead of becoming unhandled rejections.
 *
 * Express 4 does not await handlers, so without this every `await` that throws
 * would hang the request.
 */
module.exports = function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
