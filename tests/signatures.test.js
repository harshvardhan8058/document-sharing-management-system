"use strict";

/**
 * Magic-byte inspection.
 *
 * Two properties are being defended: an executable is refused whatever it is
 * called, and a file whose extension claims a specific binary format has to
 * actually be that format.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { inspect, identify, probeLength } = require("../server/utils/signatures");

/** Build a probe-sized buffer that begins with the given bytes. */
const head = (...bytes) => {
  const buffer = Buffer.alloc(probeLength());
  Buffer.from(bytes).copy(buffer);
  return buffer;
};
const ascii = (text) => head(...Buffer.from(text, "latin1"));

test("executables are refused under every extension", () => {
  const executables = {
    "dos/windows": ascii("MZ\x90\x00"),
    elf: head(0x7f, 0x45, 0x4c, 0x46, 0x02),
    "mach-o 64": head(0xcf, 0xfa, 0xed, 0xfe),
    "mach-o reversed": head(0xfe, 0xed, 0xfa, 0xcf),
    "java class": head(0xca, 0xfe, 0xba, 0xbe),
    wasm: head(0x00, 0x61, 0x73, 0x6d),
  };

  // Innocent-looking names, including the ones a user is most likely to trust.
  const names = ["payload.exe", "invoice.pdf", "notes.txt", "photo.png", "report.docx", "data.csv"];

  for (const [label, buffer] of Object.entries(executables)) {
    for (const name of names) {
      const verdict = inspect(name, buffer);
      assert.equal(verdict.ok, false, `${label} as ${name} should be refused`);
      assert.equal(verdict.code, "EXECUTABLE_REJECTED", `${label} as ${name}`);
    }
  }
});

test("genuine files matching their extension are accepted", () => {
  const cases = [
    ["real.pdf", ascii("%PDF-1.7\n")],
    ["image.png", head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["photo.jpg", head(0xff, 0xd8, 0xff, 0xe0)],
    ["photo.jpeg", head(0xff, 0xd8, 0xff, 0xdb)],
    ["anim.gif", ascii("GIF89a")],
    ["pic.bmp", ascii("BM")],
    ["archive.zip", head(0x50, 0x4b, 0x03, 0x04)],
    ["book.docx", head(0x50, 0x4b, 0x03, 0x04)],
    ["sheet.xlsx", head(0x50, 0x4b, 0x03, 0x04)],
    ["deck.pptx", head(0x50, 0x4b, 0x03, 0x04)],
    ["doc.odt", head(0x50, 0x4b, 0x03, 0x04)],
    ["bundle.gz", head(0x1f, 0x8b, 0x08)],
    ["legacy.doc", head(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    ["legacy.xls", head(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    ["notes.rtf", ascii("{\\rtf1")],
    ["clip.webm", head(0x1a, 0x45, 0xdf, 0xa3)],
    ["song.mp3", ascii("ID3\x03")],
    ["audio.wav", (() => { const b = ascii("RIFF"); Buffer.from("WAVE").copy(b, 8); return b; })()],
    ["image.webp", (() => { const b = ascii("RIFF"); Buffer.from("WEBP").copy(b, 8); return b; })()],
  ];

  for (const [name, buffer] of cases) {
    const verdict = inspect(name, buffer);
    assert.equal(verdict.ok, true, `${name} should be accepted, got ${verdict.code}: ${verdict.message}`);
  }
});

test("an mp4 is recognised from its ftyp box at offset 4", () => {
  const buffer = Buffer.alloc(probeLength());
  buffer.writeUInt32BE(0x18, 0);
  Buffer.from("ftypisom").copy(buffer, 4);

  assert.equal(identify(buffer).family, "mp4");
  assert.equal(inspect("clip.mp4", buffer).ok, true);
});

test("a tar is recognised from the ustar marker at offset 257", () => {
  const buffer = Buffer.alloc(probeLength());
  Buffer.from("some-filename").copy(buffer, 0);
  Buffer.from("ustar").copy(buffer, 257);

  assert.equal(identify(buffer).family, "tar");
  assert.equal(inspect("bundle.tar", buffer).ok, true);
});

test("content that contradicts the extension is refused", () => {
  const mismatches = [
    ["invoice.pdf", ascii("just plain text, definitely not a pdf")],
    ["photo.png", ascii("%PDF-1.4")],
    ["report.docx", ascii("%PDF-1.4")],
    ["image.jpg", head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["archive.zip", head(0x1f, 0x8b)],
  ];

  for (const [name, buffer] of mismatches) {
    const verdict = inspect(name, buffer);
    assert.equal(verdict.ok, false, `${name} should be refused`);
    assert.equal(verdict.code, "CONTENT_MISMATCH", name);
    assert.match(verdict.message, /do not match/);
  }
});

test("an empty file claiming a binary format is refused", () => {
  const empty = Buffer.alloc(0);

  assert.equal(inspect("blank.pdf", empty).ok, false);
  assert.equal(inspect("blank.png", empty).code, "CONTENT_MISMATCH");
});

test("formats without a reliable signature are left alone", () => {
  // There is nothing to check in plain text, so guessing would only reject
  // perfectly valid uploads.
  const text = ascii("# A markdown heading\n\nSome prose.\n");

  for (const name of ["notes.txt", "readme.md", "data.csv", "api.json", "feed.xml", "icon.svg", "no-extension"]) {
    assert.equal(inspect(name, text).ok, true, `${name} should be accepted`);
  }
});

test("a shebang script is allowed in a text file but an ELF binary is not", () => {
  // Uploading a shell script as .txt is harmless — it is stored as a blob and
  // always served as an attachment. A compiled binary is the real risk.
  assert.equal(inspect("setup.txt", ascii("#!/bin/bash\necho hi\n")).ok, true);
  assert.equal(inspect("setup.txt", head(0x7f, 0x45, 0x4c, 0x46)).ok, false);
});

test("extension matching is case insensitive", () => {
  const pdf = ascii("%PDF-1.5");

  assert.equal(inspect("REPORT.PDF", pdf).ok, true);
  assert.equal(inspect("Report.Pdf", pdf).ok, true);
  assert.equal(inspect("REPORT.PDF", ascii("nope")).ok, false);
});

test("identify reports both the executable and the format verdict", () => {
  assert.equal(identify(ascii("%PDF-1.7")).executable, null);
  assert.equal(identify(ascii("%PDF-1.7")).family, "pdf");
  assert.equal(identify(ascii("MZ")).executable.family, "dos-exe");
});
