"use strict";

const asyncHandler = require("../utils/asyncHandler");
const shareService = require("../services/share.service");
const { isInlinePreviewable } = require("../utils/files");
const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");

/** Absolute origin, so generated link URLs are copy-pasteable. */
const originOf = (req) => `${req.protocol}://${req.get("host")}`;

/**
 * A link password may arrive as a header (preferred — stays out of logs and
 * browser history), a query parameter (needed for `<img src>` previews), or a
 * JSON body field.
 */
function readLinkPassword(req) {
  return req.get("x-share-password") || req.query.password || (req.body && req.body.password) || "";
}

// -- owner-facing -----------------------------------------------------------

exports.listForDocument = asyncHandler(async (req, res) => {
  const shares = await shareService.listForDocument({
    id: req.params.id,
    user: req.user,
    origin: originOf(req),
  });
  res.json({ shares });
});

exports.shareWithUser = asyncHandler(async (req, res) => {
  const result = await shareService.shareWithUser({
    id: req.params.id,
    user: req.user,
    body: req.body,
    req,
    origin: originOf(req),
  });
  res.status(201).json(result);
});

exports.createLink = asyncHandler(async (req, res) => {
  const share = await shareService.createLink({
    id: req.params.id,
    user: req.user,
    body: req.body,
    req,
    origin: originOf(req),
  });
  res.status(201).json({ share });
});

exports.revoke = asyncHandler(async (req, res) => {
  res.json(
    await shareService.revoke({
      id: req.params.id,
      shareId: req.params.shareId,
      user: req.user,
      req,
    })
  );
});

// -- public (token) ---------------------------------------------------------

exports.viewByToken = asyncHandler(async (req, res) => {
  res.json(
    await shareService.viewByToken({
      token: req.params.token,
      password: readLinkPassword(req),
      req,
    })
  );
});

/**
 * Unlock a password-protected link.
 * Returns the same payload as `viewByToken` so the client can render
 * immediately after a successful unlock.
 */
exports.unlock = asyncHandler(async (req, res) => {
  res.json(
    await shareService.viewByToken({
      token: req.params.token,
      password: readLinkPassword(req),
      req,
    })
  );
});

exports.downloadByToken = asyncHandler(async (req, res, next) => {
  const { share, document, absolutePath } = await shareService.fileByToken({
    token: req.params.token,
    password: readLinkPassword(req),
  });

  res.on("finish", () => {
    shareService
      .countLinkDownload({ share, document, req })
      .catch((err) => logger.warn(`Link download counter failed: ${err.message}`));
  });

  res.download(absolutePath, document.originalName, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

exports.previewByToken = asyncHandler(async (req, res) => {
  const { document, absolutePath } = await shareService.fileByToken({
    token: req.params.token,
    password: readLinkPassword(req),
  });

  if (!isInlinePreviewable(document.mimeType)) {
    throw ApiError.badRequest("This file type cannot be previewed in the browser", {
      code: "PREVIEW_UNSUPPORTED",
    });
  }

  res.setHeader("Content-Type", document.mimeType);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(absolutePath);
});
