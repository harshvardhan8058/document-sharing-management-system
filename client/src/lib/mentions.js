/**
 * Finding and replacing the `@mention` being typed.
 *
 * Pure, and in its own module, because the fiddly part of an autocomplete is not
 * the popup — it is deciding whether the caret is inside a mention at all. Get
 * that wrong and the list appears while someone types an email address, or fails
 * to appear after a newline.
 *
 * The server resolves a mention by matching the text after `@` against an email
 * or its local part, so replacements insert the full address: unambiguous even
 * when two people share a first name.
 */

/** Characters allowed in a handle. Mirrors the server's mention pattern. */
const HANDLE = /[A-Za-z0-9._%+@-]/;

/**
 * The mention token the caret sits in, if any.
 *
 * @returns {{ query: string, start: number, end: number } | null}
 */
export function activeMention(text = "", caret = text.length) {
  const value = String(text ?? "");
  if (caret < 0) return null;
  const position = Math.max(0, Math.min(value.length, caret));

  // Walk back to the "@" that starts this token.
  let index = position - 1;
  while (index >= 0 && HANDLE.test(value[index]) && value[index] !== "@") index -= 1;

  if (index < 0 || value[index] !== "@") return null;

  /*
   * An "@" only starts a mention at a word boundary. Without this, typing an
   * address like "ada@example.com" would pop the list open in the middle of it.
   */
  const before = index > 0 ? value[index - 1] : "";
  if (before && !/[\s(<[{,;:]/.test(before)) return null;

  const query = value.slice(index + 1, position);

  // A handle cannot contain whitespace, and an over-long one is not a handle.
  if (/\s/.test(query) || query.length > 64) return null;

  return { query, start: index, end: position };
}

/**
 * Replace the active mention with a chosen address.
 *
 * @returns {{ text: string, caret: number }} the new value and where to put the
 *   caret, which is after the trailing space so typing simply continues.
 */
export function applyMention(text = "", token, email) {
  const value = String(text ?? "");
  if (!token || !email) return { text: value, caret: value.length };

  /*
   * A trailing space, unless the text already continues with one. Always adding
   * it leaves "@rio@dsms.dev  and tell me" — a double space in the middle of a
   * sentence, from a feature whose whole job is to save typing.
   */
  const rest = value.slice(token.end);
  const insertion = `@${email}${/^\s/.test(rest) ? "" : " "}`;
  const next = value.slice(0, token.start) + insertion + rest;
  return { text: next, caret: token.start + insertion.length };
}
