/**
 * Extension → category mapping, mirroring `server/utils/files.js`.
 *
 * The client needs this before an upload exists server-side, so the right icon
 * can be shown in the queue. `tests/fileTypes.test.js` asserts the two maps
 * agree, so a new type added on one side cannot silently disagree on the other.
 */

export const CATEGORY_BY_EXTENSION = {
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

/** Lowercase extension without the dot; "" when there is none. */
export function extensionOf(filename = "") {
  const name = String(filename);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function categoryOf(filename) {
  return CATEGORY_BY_EXTENSION[extensionOf(filename)] || "other";
}
