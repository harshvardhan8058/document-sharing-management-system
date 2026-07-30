import { useCallback, useMemo, useState } from "react";

/**
 * Multi-selection over an ordered list of ids.
 *
 * Implements the conventions people already know from file managers, because
 * inventing new ones here would only cost them: click toggles, shift extends a
 * contiguous range from the last touched item, and a selection is cleared by
 * acting on it or by pressing Escape.
 *
 * The anchor is tracked separately from the selection so shift-clicking twice
 * grows and shrinks the same range rather than starting a new one each time.
 */
export function useSelection(orderedIds = []) {
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);

  const ids = useMemo(() => orderedIds, [orderedIds]);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  const toggle = useCallback((id, { extend = false } = {}) => {
    setSelected((current) => {
      const next = new Set(current);

      // Shift-click: select everything between the anchor and here.
      if (extend && anchor && ids.includes(anchor) && ids.includes(id)) {
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(id);
        for (const between of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          next.add(between);
        }
        return next;
      }

      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

    setAnchor(id);
  }, [anchor, ids]);

  const selectAll = useCallback(() => {
    setSelected(new Set(ids));
  }, [ids]);

  /**
   * Drop ids that are no longer on screen.
   *
   * Called after a refetch: without it, acting on a selection could target a
   * document that has been filtered away or deleted by someone else.
   */
  const prune = useCallback((availableIds) => {
    const available = new Set(availableIds);
    setSelected((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, []);

  return {
    selected,
    selectedIds: useMemo(() => [...selected], [selected]),
    count: selected.size,
    isSelected: useCallback((id) => selected.has(id), [selected]),
    active: selected.size > 0,
    toggle,
    selectAll,
    clear,
    prune,
    allSelected: ids.length > 0 && selected.size === ids.length,
  };
}
