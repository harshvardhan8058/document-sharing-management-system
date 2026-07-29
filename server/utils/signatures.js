"use strict";

/**
 * Magic-byte inspection.
 *
 * The extension allow-list alone is decoration: it reads a name the client
 * chose. `payroll.exe` renamed `report.pdf` passed it. This module looks at what
 * the bytes actually are.
 *
 * Two independent rules are enforced by the caller:
 *
 *  1. Executables are refused outright, whatever the file is called. Nothing
 *     here ever runs an upload, but a user tricked into downloading and opening
 *     one is a real outcome, and this is the cheapest place to stop it.
 *  2. When an extension implies a specific binary format, the bytes must agree.
 *     Formats with no reliable signature (plain text, CSV, JSON, SVG) are
 *     exempt — there is nothing to check, and guessing would reject valid files.
 */

const { extensionOf } = require("./files");

/** Longest offset any probe below needs (the tar `ustar` marker sits at 257). */
const PROBE_BYTES = 264;

const startsWith = (buffer, bytes) =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const asciiAt = (buffer, offset, text) =>
  buffer.length >= offset + text.length &&
  buffer.subarray(offset, offset + text.length).toString("latin1") === text;

/** Executable / loadable-object formats, refused for every extension. */
const EXECUTABLE_PROBES = [
  { family: "dos-exe", label: "a Windows/DOS executable", test: (b) => asciiAt(b, 0, "MZ") },
  { family: "elf", label: "a Linux ELF binary", test: (b) => startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) },
  {
    family: "mach-o",
    label: "a macOS Mach-O binary",
    test: (b) =>
      startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) ||
      startsWith(b, [0xce, 0xfa, 0xed, 0xfe]) ||
      startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) ||
      startsWith(b, [0xfe, 0xed, 0xfa, 0xce]),
  },
  {
    family: "java-class",
    label: "a Java class file or fat Mach-O binary",
    test: (b) => startsWith(b, [0xca, 0xfe, 0xba, 0xbe]),
  },
  { family: "wasm", label: "a WebAssembly module", test: (b) => startsWith(b, [0x00, 0x61, 0x73, 0x6d]) },
];

/** Container/document formats we can positively identify. */
const FORMAT_PROBES = [
  { family: "pdf", test: (b) => asciiAt(b, 0, "%PDF-") },
  { family: "png", test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { family: "jpeg", test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { family: "gif", test: (b) => asciiAt(b, 0, "GIF87a") || asciiAt(b, 0, "GIF89a") },
  { family: "webp", test: (b) => asciiAt(b, 0, "RIFF") && asciiAt(b, 8, "WEBP") },
  { family: "wav", test: (b) => asciiAt(b, 0, "RIFF") && asciiAt(b, 8, "WAVE") },
  { family: "bmp", test: (b) => asciiAt(b, 0, "BM") },
  { family: "matroska", test: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  { family: "mp4", test: (b) => asciiAt(b, 4, "ftyp") },
  { family: "gzip", test: (b) => startsWith(b, [0x1f, 0x8b]) },
  { family: "bzip2", test: (b) => asciiAt(b, 0, "BZh") },
  { family: "7z", test: (b) => startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { family: "rar", test: (b) => asciiAt(b, 0, "Rar!") },
  { family: "rtf", test: (b) => asciiAt(b, 0, "{\\rtf") },
  // Legacy Office (.doc/.xls/.ppt) compound files.
  { family: "ole", test: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
  // OOXML and OpenDocument are zip archives; keep this after the more specific probes.
  {
    family: "zip",
    test: (b) =>
      startsWith(b, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(b, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(b, [0x50, 0x4b, 0x07, 0x08]),
  },
  { family: "tar", test: (b) => asciiAt(b, 257, "ustar") },
  { family: "id3", test: (b) => asciiAt(b, 0, "ID3") },
  {
    family: "mpeg-audio",
    test: (b) => b.length >= 2 && b[0] === 0xff && [0xfb, 0xf3, 0xf2, 0xe3].includes(b[1]),
  },
];

/**
 * Families each extension may legitimately be.
 * An extension absent from this map is treated as unverifiable.
 */
const EXPECTED_FAMILIES = {
  pdf: ["pdf"],

  png: ["png"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  gif: ["gif"],
  webp: ["webp"],
  bmp: ["bmp"],

  // OOXML / OpenDocument are zip containers.
  docx: ["zip"],
  xlsx: ["zip"],
  pptx: ["zip"],
  odt: ["zip"],
  ods: ["zip"],
  odp: ["zip"],

  // Legacy Office. Files saved as .doc are frequently RTF or even OOXML in
  // practice, so all three are accepted rather than rejecting valid documents.
  doc: ["ole", "rtf", "zip"],
  xls: ["ole", "zip"],
  ppt: ["ole", "zip"],
  rtf: ["rtf", "ole"],

  zip: ["zip"],
  gz: ["gzip"],
  tar: ["tar", "gzip"],
  "7z": ["7z"],
  rar: ["rar"],

  mp3: ["id3", "mpeg-audio"],
  wav: ["wav"],
  mp4: ["mp4"],
  webm: ["matroska"],
  mov: ["mp4"],
  mkv: ["matroska"],
};

/** Human-friendly names, used only in error messages. */
const FAMILY_LABELS = {
  pdf: "a PDF",
  png: "a PNG image",
  jpeg: "a JPEG image",
  gif: "a GIF image",
  webp: "a WebP image",
  bmp: "a BMP image",
  zip: "a ZIP archive",
  gzip: "a gzip archive",
  tar: "a tar archive",
  "7z": "a 7-Zip archive",
  rar: "a RAR archive",
  ole: "a legacy Office document",
  rtf: "an RTF document",
  mp4: "an MP4 container",
  matroska: "a Matroska/WebM container",
  wav: "a WAV audio file",
  id3: "an MP3 file",
  "mpeg-audio": "an MPEG audio file",
  bzip2: "a bzip2 archive",
};

/** Number of leading bytes worth reading for inspection. */
const probeLength = () => PROBE_BYTES;

/**
 * Identify a buffer of leading bytes.
 * @returns {{executable: object|null, family: string|null}}
 */
function identify(buffer) {
  const executable = EXECUTABLE_PROBES.find((probe) => probe.test(buffer)) || null;
  const format = FORMAT_PROBES.find((probe) => probe.test(buffer)) || null;
  return { executable, family: format ? format.family : null };
}

/** True when the extension carries no reliably checkable signature. */
const isUnverifiable = (extension) => !EXPECTED_FAMILIES[extension];

/**
 * Decide whether `buffer` is acceptable for a file named `filename`.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string, detected: string|null}}
 */
function inspect(filename, buffer) {
  const extension = extensionOf(filename);
  const { executable, family } = identify(buffer);

  if (executable) {
    return {
      ok: false,
      code: "EXECUTABLE_REJECTED",
      detected: executable.family,
      message: `This file is ${executable.label}. Executables cannot be uploaded, whatever their name.`,
    };
  }

  const expected = EXPECTED_FAMILIES[extension];
  if (!expected) return { ok: true };

  if (family && expected.includes(family)) return { ok: true };

  const describedAs = family
    ? (FAMILY_LABELS[family] || `a ${family} file`)
    : "not a recognisable file of that type";

  return {
    ok: false,
    code: "CONTENT_MISMATCH",
    detected: family,
    message: `The contents of this file do not match its ".${extension}" extension — it is ${describedAs}.`,
  };
}

module.exports = {
  inspect,
  identify,
  probeLength,
  isUnverifiable,
  EXPECTED_FAMILIES,
  PROBE_BYTES,
};
