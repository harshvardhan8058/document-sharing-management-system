/**
 * Drag payload helpers, kept in a plain `.js` module so `node --test` can cover
 * them without a JSX transform.
 *
 * Dragging documents onto a collection has one rule that is easy to get wrong:
 * a drag that begins on a card which is part of a selection must carry the
 * *whole* selection, because that is what the user can see highlighted. The
 * browser only tells the drop target what the dragged element put on the
 * DataTransfer, which is a single id, so the selection has to be reconciled at
 * the drop site.
 */

export const DOCUMENT_DRAG_TYPE = "application/x-dsms-documents";

/**
 * Decide which documents a drop should apply to.
 *
 * @param {string|null|undefined} raw   the DataTransfer payload for `DOCUMENT_DRAG_TYPE`
 * @param {string[]} selectedIds        ids currently selected in the library
 * @returns {string[]} the ids to act on, de-duplicated and order-preserving
 */
export function resolveDropIds(raw, selectedIds = []) {
  const selection = dedupe(Array.isArray(selectedIds) ? selectedIds.filter(isId) : []);

  let dragged = [];
  if (typeof raw === "string" && raw !== "") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) dragged = dedupe(parsed.filter(isId));
    } catch {
      // A non-JSON payload means the drag came from outside the app.
      dragged = [];
    }
  }

  // Nothing was dragged from a card: fall back to whatever is selected, so
  // dropping onto a collection still does the obvious thing.
  if (!dragged.length) return selection;

  // Dragging one card that belongs to the selection means "move all of these".
  // Dragging a card *outside* the selection means only that card, which is the
  // behaviour every file manager has.
  if (dragged.length === 1 && selection.includes(dragged[0])) return selection;

  return dragged;
}

function isId(value) {
  return typeof value === "string" && value.length > 0;
}

function dedupe(list) {
  return [...new Set(list)];
}
