"use strict";

const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

const config = require("../config/env");
const ApiError = require("../utils/ApiError");
const { extensionOf, formatBytes } = require("../utils/files");

// The upload directory has to exist before multer writes to it — otherwise the
// very first upload fails with ENOENT (the original code never created it).
fs.mkdirSync(config.uploads.dir, { recursive: true });

/**
 * Stored filenames are generated, never derived from user input.
 *
 * `${timestamp}-${random}.${ext}` gives collision-free, path-traversal-proof
 * names. The human-readable name the user uploaded is kept in the database and
 * re-applied via Content-Disposition on download.
 */
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, config.uploads.dir);
  },
  filename(req, file, cb) {
    const ext = extensionOf(file.originalname);
    const unique = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
    cb(null, ext ? `${unique}.${ext}` : unique);
  },
});

function fileFilter(req, file, cb) {
  const allowed = config.uploads.allowedExtensions;
  if (!allowed.length) return cb(null, true); // empty allow-list = accept anything

  const ext = extensionOf(file.originalname);
  if (!ext) {
    return cb(
      new ApiError(415, "Files must have a file extension", { code: "MISSING_EXTENSION" })
    );
  }
  if (!allowed.includes(ext)) {
    return cb(
      new ApiError(415, `".${ext}" files are not allowed`, {
        code: "EXTENSION_NOT_ALLOWED",
        details: [{ field: "file", extension: ext }],
      })
    );
  }
  cb(null, true);
}

const multerInstance = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1,
    fields: 20,
  },
});

/** Map multer's own error codes onto client-safe ApiErrors. */
function translateMulterError(err) {
  if (!(err instanceof multer.MulterError)) return err;

  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return new ApiError(413, `Files must be ${formatBytes(config.uploads.maxBytes)} or smaller`, {
        code: "FILE_TOO_LARGE",
      });
    case "LIMIT_FILE_COUNT":
      return ApiError.badRequest("Only one file can be uploaded at a time", {
        code: "TOO_MANY_FILES",
      });
    case "LIMIT_UNEXPECTED_FILE":
      return ApiError.badRequest(`Unexpected file field "${err.field}" — use "file"`, {
        code: "UNEXPECTED_FIELD",
      });
    default:
      return ApiError.badRequest(`Upload failed: ${err.message}`, { code: "UPLOAD_FAILED" });
  }
}

/**
 * Accept a single optional file on `field`.
 * @param {string} field multipart field name
 * @param {{required?: boolean}} [options]
 */
function singleFile(field = "file", { required = true } = {}) {
  const handler = multerInstance.single(field);

  return function uploadMiddleware(req, res, next) {
    handler(req, res, (err) => {
      if (err) return next(translateMulterError(err));
      if (required && !req.file) {
        return next(
          ApiError.badRequest(`A file is required — attach it as the "${field}" form field`, {
            code: "FILE_REQUIRED",
          })
        );
      }
      next();
    });
  };
}

module.exports = { singleFile, multerInstance, translateMulterError };
