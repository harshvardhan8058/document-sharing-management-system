/**
 * Line diff, for comparing two versions of a document.
 *
 * Plain `.js` so `node --test` can cover it without a JSX transform. A document
 * vault that keeps every version but cannot tell you what changed between two of
 * them is only half a vault — "v3, 4 KB" says nothing about whether a sentence or
 * the whole file moved.
 *
 * No dependency: the useful part of a diff library is the algorithm, and the
 * algorithm is about eighty lines.
 */

/** Hard ceiling on the quadratic step. Beyond this we degrade rather than hang. */
const MAX_DP_LINES = 1200;

/**
 * Compare two texts line by line.
 *
 * @returns {{rows: Array, added: number, removed: number, truncated: boolean}}
 *   `rows` are `{ type: "equal"|"add"|"remove", text, before, after }`, where
 *   `before`/`after` are 1-based line numbers or null.
 */
export function diffLines(beforeText = "", afterText = "") {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  /*
   * Trim the matching head and tail first.
   *
   * Edits are local: a paragraph changes in the middle of a file that is
   * otherwise identical. Removing the shared ends is what keeps the expensive
   * step small enough to be honest about, and it costs one pass.
   */
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const middleBefore = before.slice(head, before.length - tail);
  const middleAfter = after.slice(head, after.length - tail);

  const truncated = middleBefore.length > MAX_DP_LINES || middleAfter.length > MAX_DP_LINES;

  const middleRows = truncated
    ? // Too big to align precisely: report the changed span as a block rather
      // than pretending to know which lines pair up.
      [
        ...middleBefore.map((text, index) => row("remove", text, head + index + 1, null)),
        ...middleAfter.map((text, index) => row("add", text, null, head + index + 1)),
      ]
    : align(middleBefore, middleAfter, head);

  const rows = [
    ...before.slice(0, head).map((text, index) => row("equal", text, index + 1, index + 1)),
    ...middleRows,
    ...before
      .slice(before.length - tail)
      .map((text, index) => row("equal", text, before.length - tail + index + 1, after.length - tail + index + 1)),
  ];

  return {
    rows,
    added: rows.filter((entry) => entry.type === "add").length,
    removed: rows.filter((entry) => entry.type === "remove").length,
    truncated,
  };
}

function row(type, text, before, after) {
  return { type, text, before, after };
}

function splitLines(text) {
  const value = String(text ?? "");
  if (value === "") return [];
  // Normalise line endings so a file edited on Windows does not read as a
  // rewrite of every line.
  return value.replace(/\r\n?/g, "\n").split("\n");
}

/** Longest-common-subsequence alignment over the differing middle. */
function align(before, after, offset) {
  const rowsCount = before.length;
  const colsCount = after.length;

  // lengths[i][j] = LCS length of before[i..] and after[j..], flattened.
  const width = colsCount + 1;
  const lengths = new Int32Array((rowsCount + 1) * width);

  for (let i = rowsCount - 1; i >= 0; i -= 1) {
    for (let j = colsCount - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + (j + 1)] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + (j + 1)]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;

  while (i < rowsCount && j < colsCount) {
    if (before[i] === after[j]) {
      out.push(row("equal", before[i], offset + i + 1, offset + j + 1));
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
      out.push(row("remove", before[i], offset + i + 1, null));
      i += 1;
    } else {
      out.push(row("add", after[j], null, offset + j + 1));
      j += 1;
    }
  }

  while (i < rowsCount) {
    out.push(row("remove", before[i], offset + i + 1, null));
    i += 1;
  }
  while (j < colsCount) {
    out.push(row("add", after[j], null, offset + j + 1));
    j += 1;
  }

  return out;
}

/**
 * Group rows into hunks, keeping `context` unchanged lines around each change.
 *
 * A diff of a long file is mostly lines that did not change, and showing all of
 * them buries the ones that did.
 */
export function toHunks(rows, context = 3) {
  const changed = rows.map((entry) => entry.type !== "equal");
  const keep = new Array(rows.length).fill(false);

  for (let index = 0; index < rows.length; index += 1) {
    if (!changed[index]) continue;
    for (let near = Math.max(0, index - context); near <= Math.min(rows.length - 1, index + context); near += 1) {
      keep[near] = true;
    }
  }

  const hunks = [];
  let current = null;

  for (let index = 0; index < rows.length; index += 1) {
    if (keep[index]) {
      if (!current) {
        current = { rows: [], skippedBefore: 0 };
        hunks.push(current);
      }
      current.rows.push(rows[index]);
    } else if (current) {
      current = null;
    }
  }

  // How many unchanged lines each hunk is hiding, so the gap can be labelled
  // rather than silently swallowing content.
  let seen = 0;
  let hunkIndex = 0;
  let inHunk = false;
  for (let index = 0; index < rows.length; index += 1) {
    if (keep[index]) {
      if (!inHunk) {
        hunks[hunkIndex].skippedBefore = seen;
        seen = 0;
        inHunk = true;
      }
    } else if (inHunk) {
      inHunk = false;
      hunkIndex += 1;
      seen = 1;
    } else {
      seen += 1;
    }
  }

  return hunks;
}
