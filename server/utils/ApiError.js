"use strict";

/**
 * An error that is safe to surface to API clients.
 *
 * Anything thrown that is *not* an ApiError is treated as an unexpected
 * failure by the error handler and reported as a generic 500, so internal
 * details never leak.
 */
class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Human readable, client-safe message
   * @param {object} [options]
   * @param {string} [options.code] Stable machine-readable code
   * @param {Array}  [options.details] Field-level details (validation errors)
   */
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.expose = true;
    this.code = code || ApiError.defaultCode(status);
    if (details) this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static defaultCode(status) {
    return (
      {
        400: "BAD_REQUEST",
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA_TYPE",
        422: "UNPROCESSABLE_ENTITY",
        429: "RATE_LIMITED",
      }[status] || "INTERNAL_ERROR"
    );
  }

  static badRequest(message = "Bad request", options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = "Authentication required", options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = "You do not have access to this resource", options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = "Resource not found", options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = "Resource already exists", options) {
    return new ApiError(409, message, options);
  }

  static unprocessable(message = "Validation failed", options) {
    return new ApiError(422, message, options);
  }
}

module.exports = ApiError;
