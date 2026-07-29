"use strict";

const config = require("../config/env");
const logger = require("../utils/logger");

/**
 * Log one line per request *after* it finishes, so the status code and duration
 * are known. The original implementation logged on the way in, which meant a
 * request that 500'd looked identical to one that succeeded.
 */
function requestLogger(req, res, next) {
  if (config.isTest) return next();

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;

    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.debug(line);
  });

  next();
}

module.exports = requestLogger;
