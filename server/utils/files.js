"use strict";

const path = require("path");

/**
 * Coarse categories used for filtering and for picking an icon in the UI.
 * Derived from the extension rather than the client-supplied MIME type, which
 * is trivially spoofable.
 */
const CATEGORY_BY_EXTENSION = {
  pdf: "pdf",

  doc: "document", docx: "document", odt: "document", rtf: "document",
  txt: "document", md: "document",

  xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet", ods: "spreadsheet",

  ppt: "presentation", pptx: "presentation", odp: "presentation",

  png: "image", jpg: "image", jpeg: "image", gif: "image",
  webp: "image", svg: "image", bmp: "image", avif: "image",

  zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive",

  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio",

  mp4: "video", webm: "video", mov: "video", avi: "video", mkv: "video",

  json: "code", xml: "code", yml: "code", yaml: "code",
  js: "code", ts: "code", py: "code", java: "code", html: "code", css: "code",
};

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Lowercase extension without the dot; "" when there is none. */
function extensionOf(filename = "") {
  return path.extname(String(filename)).replace(/^\./, "").toLowerCase();
}

function categoryOf(filename) {
  return CATEGORY_BY_EXTENSION[extensionOf(filename)] || "other";
}

function mimeTypeOf(filename, fallback = "application/octet-stream") {
  return MIME_BY_EXTENSION[extensionOf(filename)] || fallback;
}

/**
 * True when the browser can render the file inline without downloading it.
 * Note: SVG is excluded on purpose — inline SVG can carry script.
 */
function isInlinePreviewable(mimeType = "") {
  return (
    /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(mimeType) ||
    mimeType === "application/pdf" ||
    /^text\/(plain|markdown|csv)$/.test(mimeType)
  );
}

/**
 * Strip anything that could escape the upload directory or confuse the OS,
 * then clamp the length. Never trust `file.originalname`.
 */
function sanitizeFilename(original = "file") {
  const base = path
    .basename(String(original))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const safe = base.replace(/^\.+/, "") || "file";
  if (safe.length <= 180) return safe;
  const ext = path.extname(safe);
  return safe.slice(0, 180 - ext.length) + ext;
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

module.exports = {
  extensionOf,
  categoryOf,
  mimeTypeOf,
  isInlinePreviewable,
  sanitizeFilename,
  formatBytes,
  CATEGORY_BY_EXTENSION,
};
