"use strict";

/**
 * Deciding whether the caret is inside an `@mention`.
 *
 * This is the part of an autocomplete that is easy to get wrong in ways that are
 * annoying rather than obvious: a list that opens halfway through an email
 * address, or refuses to open on a new line, or reappears after you dismiss it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let mentions;

test.before(async () => {
  mentions = await import("../client/src/lib/mentions.js");
});

test("a mention at the caret is found", () => {
  const { activeMention } = mentions;

  const found = activeMention("hello @ri", 9);
  assert.deepEqual({ query: found.query, start: found.start }, { query: "ri", start: 6 });
});

test("an empty mention counts, so the list can open on the bare @", () => {
  const { activeMention } = mentions;

  const found = activeMention("hello @", 7);
  assert.equal(found.query, "");
});

test("a mention at the very start of the text is found", () => {
  const { activeMention } = mentions;

  assert.equal(activeMention("@ada", 4).query, "ada");
});

test("a mention after a newline or a bracket is found", () => {
  const { activeMention } = mentions;

  // Real comments start mentions on their own line, or inside parentheses.
  assert.equal(activeMention("line one\n@ada", 13).query, "ada");
  assert.equal(activeMention("(@ada", 5).query, "ada");
});

test("an email address does not open the list mid-word", () => {
  const { activeMention } = mentions;

  // The "@" here is inside a word, so it is an address, not a mention.
  assert.equal(activeMention("write to ada@example.com", 24), null);
  assert.equal(activeMention("ada@exam", 8), null);
});

test("the caret has to be in the token", () => {
  const { activeMention } = mentions;

  // Caret before the "@".
  assert.equal(activeMention("hello @ada", 3), null);
  // Caret past the end of the mention, after a space.
  assert.equal(activeMention("hello @ada ", 11), null);
});

test("whitespace ends a mention", () => {
  const { activeMention } = mentions;

  assert.equal(activeMention("hello @ada smith", 16), null);
});

test("text with no mention at all yields nothing", () => {
  const { activeMention } = mentions;

  assert.equal(activeMention("", 0), null);
  assert.equal(activeMention("no mentions here", 16), null);
  assert.equal(activeMention(undefined, 0), null);
});

test("a caret beyond the text is clamped rather than throwing", () => {
  const { activeMention } = mentions;

  assert.equal(activeMention("hi @ada", 999).query, "ada");
  assert.equal(activeMention("hi @ada", -5), null);
});

test("choosing a person replaces the token and leaves the caret after it", () => {
  const { activeMention, applyMention } = mentions;

  const text = "please review @ri and tell me";
  const token = activeMention(text, 17);
  const result = applyMention(text, token, "rio@dsms.dev");

  // No double space: the sentence already continued with one.
  assert.equal(result.text, "please review @rio@dsms.dev and tell me");
  assert.equal(result.text.slice(0, result.caret), "please review @rio@dsms.dev");
});

test("replacement keeps the rest of the comment intact", () => {
  const { activeMention, applyMention } = mentions;

  const text = "@a\nsecond line";
  const token = activeMention(text, 2);
  const result = applyMention(text, token, "ada@dsms.dev");

  assert.equal(result.text, "@ada@dsms.dev\nsecond line");
});

test("replacing with nothing selected changes nothing", () => {
  const { applyMention } = mentions;

  assert.equal(applyMention("unchanged", null, "a@b.c").text, "unchanged");
  assert.equal(applyMention("unchanged", { start: 0, end: 1 }, "").text, "unchanged");
});


test("a trailing space is added only when the text does not already have one", () => {
  const { activeMention, applyMention } = mentions;

  // End of the comment: the space is wanted, so typing continues naturally.
  const atEnd = "thanks @ri";
  const ended = applyMention(atEnd, activeMention(atEnd, 10), "rio@dsms.dev");
  assert.equal(ended.text, "thanks @rio@dsms.dev ");

  // Followed by a newline: no space, or the line gains trailing whitespace.
  const beforeNewline = "@ri\nnext paragraph";
  const wrapped = applyMention(beforeNewline, activeMention(beforeNewline, 3), "rio@dsms.dev");
  assert.equal(wrapped.text, "@rio@dsms.dev\nnext paragraph");
});
