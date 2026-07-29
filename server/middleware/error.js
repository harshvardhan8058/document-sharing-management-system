"use strict";

const fs = require("fs/promises");
const multer = require("multer");

const config = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/ApiError");
const { translateMulterError } = require("./upload");

/** Terminal 404 for unmatched API routes. */
function notFound(req, res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`, { code: "ROUTE_NOT_FOUND" }));
}

/**
 * Single error responder for the whole API.
 *
 * Three things the original 5-line handler got wrong and this fixes:
 *  1. every failure became a 500 — validation and not-found included;
 *  2. it replied with plain text, so the client could not parse errors;
 *  3. a request that failed *after* multer wrote a file left that file
 *     orphaned on disk forever.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
async function errorHandler(err, req, res, next) {
  let error = err;

  if (error instanceof multer.MulterError) error = translateMulterError(error);

  // Body-parser rejects malformed JSON with a SyntaxError carrying a status.
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    error = ApiError.badRequest("Request body is not valid JSON", { code: "MALFORMED_JSON" });
  }

  const isApiError = error instanceof ApiError;
  const status = isApiError ? error.status : Number(error.status) || Number(error.statusCode) || 500;

  // Discard any file multer already accepted for a request that ultimately failed.
  if (req.file && req.file.path) {
    await fs.unlink(req.file.path).catch(() => {});
  }

  if (status >= 500) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, error);
  }

  const body = {
    error: {
      code: isApiError ? error.code : ApiError.defaultCode(status),
      message:
        isApiError || status < 500
          ? error.message
          : "Something went wrong on our side. Please try again.",
    },
  };

  if (isApiError && error.details) body.error.details = error.details;
  if (!config.isProduction && status >= 500) body.error.stack = error.stack;

  if (res.headersSent) {
    // Streaming download already started — the connection has to be torn down.
    return res.destroy(error);
  }

  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
