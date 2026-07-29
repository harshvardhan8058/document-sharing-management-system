"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const documentService = require("../services/document.service");
const storage = require("../services/storage.service");
const { isInlinePreviewable } = require("../utils/files");
const logger = require("../utils/logger");

exports.list = asyncHandler(async (req, res) => {
  res.json(await documentService.list({ user: req.user, query: req.query }));
});

exports.tags = asyncHandler(async (req, res) => {
  res.json({ tags: await documentService.tagsFor(req.user) });
});

exports.getOne = asyncHandler(async (req, res) => {
  res.json(await documentService.getOne({ id: req.params.id, user: req.user, req }));
});

exports.create = asyncHandler(async (req, res) => {
  const document = await documentService.create({
    user: req.user,
    file: req.file,
    body: req.body,
    req,
  });
  res.status(201).json({ document });
});

exports.update = asyncHandler(async (req, res) => {
  const document = await documentService.update({
    id: req.params.id,
    user: req.user,
    body: req.body,
    req,
  });
  res.json({ document });
});

exports.addVersion = asyncHandler(async (req, res) => {
  const document = await documentService.addVersion({
    id: req.params.id,
    user: req.user,
    file: req.file,
    body: req.body,
    req,
  });
  res.status(201).json({ document });
});

exports.star = asyncHandler(async (req, res) => {
  const starred = req.method === "PUT" || req.body.starred === true;
  const document = await documentService.setStar({
    id: req.params.id,
    user: req.user,
    starred,
    req,
  });
  res.json({ document });
});

exports.trash = asyncHandler(async (req, res) => {
  const document = await documentService.trash({ id: req.params.id, user: req.user, req });
  res.json({ document });
});

exports.restore = asyncHandler(async (req, res) => {
  const document = await documentService.restore({ id: req.params.id, user: req.user, req });
  res.json({ document });
});

exports.destroy = asyncHandler(async (req, res) => {
  res.json(await documentService.destroy({ id: req.params.id, user: req.user, req }));
});

exports.emptyTrash = asyncHandler(async (req, res) => {
  res.json(await documentService.emptyTrash({ user: req.user, req }));
});

/**
 * Stream the file as an attachment.
 *
 * The counter is bumped only once the response has actually been flushed, so an
 * aborted transfer is not recorded as a download.
 */
exports.download = asyncHandler(async (req, res, next) => {
  const { document, absolutePath, target } = await documentService.resolveFile({
    id: req.params.id,
    user: req.user,
    version: req.query.version,
  });

  res.on("finish", () => {
    documentService
      .countDownload({
        id: document.id,
        user: req.user,
        req,
        document,
        detail: `v${target.version} — ${target.originalName}`,
      })
      .catch((err) => logger.warn(`Download counter failed: ${err.message}`));
  });

  res.download(absolutePath, target.originalName, (err) => {
    // Fires for both send failures and client aborts; only the former is ours
    // to report, and only if nothing has been written yet.
    if (err && !res.headersSent) next(err);
  });
});

/**
 * Render the file inline for the in-app preview pane.
 *
 * Only formats browsers can display safely are served inline; anything else is
 * redirected to the download route. `X-Content-Type-Options: nosniff` plus a
 * restrictive CSP stop a crafted upload from executing in our origin.
 */
exports.preview = asyncHandler(async (req, res) => {
  const { document, absolutePath, target } = await documentService.resolveFile({
    id: req.params.id,
    user: req.user,
    version: req.query.version,
  });

  if (!isInlinePreviewable(target.mimeType)) {
    throw ApiError.badRequest("This file type cannot be previewed in the browser", {
      code: "PREVIEW_UNSUPPORTED",
      details: [{ mimeType: target.mimeType, downloadUrl: `/api/documents/${document.id}/download` }],
    });
  }

  res.setHeader("Content-Type", target.mimeType);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(target.originalName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(absolutePath);
});

/** Plain-text preview payload for text/markdown/csv, capped server-side. */
exports.textPreview = asyncHandler(async (req, res) => {
  const { target } = await documentService.resolveFile({
    id: req.params.id,
    user: req.user,
    version: req.query.version,
  });

  if (!/^text\/|application\/(json|xml)/.test(target.mimeType)) {
    throw ApiError.badRequest("This file is not text", { code: "NOT_TEXT" });
  }

  res.json(await storage.readTextPreview(target.storedName));
});
