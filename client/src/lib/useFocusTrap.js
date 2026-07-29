import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keep keyboard focus inside an overlay while it is open.
 *
 * Without this, Tab walks straight out of a dialog and into the page behind it:
 * a keyboard or screen-reader user ends up interacting with content they cannot
 * see and cannot get back from. The modal previously only focused its first
 * field, and the document drawer did nothing at all.
 *
 * Also locks background scrolling and restores focus to whatever was focused
 * before the overlay opened.
 *
 * @param {boolean} active
 * @param {{onEscape?: () => void, autoFocus?: boolean}} options
 * @returns {import("react").RefObject<HTMLElement>} attach to the container
 */
export function useFocusTrap(active, { onEscape, autoFocus = true } = {}) {
  const containerRef = useRef(null);
  const restoreRef = useRef(null);
  // Held in a ref so a re-created handler prop does not tear down the trap.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;

    restoreRef.current = document.activeElement;

    /**
     * Always read the ref at call time rather than capturing it when the effect
     * runs. A panel that renders a loading skeleton first and its real content
     * second swaps the underlying node, and a captured reference would be left
     * pointing at a detached element — which silently traps Tab against an empty
     * list instead of cycling the visible controls.
     */
    const focusable = () => {
      const container = containerRef.current;
      if (!container) return [];
      return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
    };

    if (autoFocus) {
      const [first] = focusable().filter((element) => element.dataset.autofocus !== "skip");
      // Falling back to the container keeps focus inside even when the overlay
      // holds nothing focusable yet (for example while it is still loading).
      (first || containerRef.current)?.focus?.();
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return; // nothing mounted yet — let the browser do its thing

      const elements = focusable();
      if (!elements.length) return;

      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = document.activeElement;

      // Wrap around, and pull focus back if it has already escaped the container.
      if (event.shiftKey && (activeElement === first || !container.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !container.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [active, autoFocus]);

  return containerRef;
}
