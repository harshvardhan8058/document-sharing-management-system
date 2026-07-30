import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Motion primitives.
 *
 * Every hook here checks `prefers-reduced-motion` and degrades to the final
 * state immediately rather than animating. Motion is decoration; the interface
 * has to be complete without it.
 */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Live reduced-motion preference, so a mid-session change is honoured. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;

    const onChange = (event) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Track the pointer inside an element and expose it as CSS custom properties.
 *
 * Writing `--px`/`--py` straight onto the node keeps this off the React render
 * path entirely — pointer moves fire dozens of times a second and re-rendering
 * a grid of cards at that rate would drop frames. The visual result lives in CSS.
 *
 * @param {{tilt?: number}} options maximum tilt in degrees; 0 disables tilt
 */
export function usePointerSpotlight({ tilt = 0 } = {}) {
  const ref = useRef(null);
  const frame = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return undefined;

    const onPointerMove = (event) => {
      // Coalesce to one write per frame; pointermove can outpace the compositor.
      if (frame.current) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = 0;

        const rect = node.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        node.style.setProperty("--px", `${(x * 100).toFixed(2)}%`);
        node.style.setProperty("--py", `${(y * 100).toFixed(2)}%`);

        if (tilt) {
          // Centre-relative, so the card leans away from the cursor.
          node.style.setProperty("--tilt-x", `${((y - 0.5) * -2 * tilt).toFixed(2)}deg`);
          node.style.setProperty("--tilt-y", `${((x - 0.5) * 2 * tilt).toFixed(2)}deg`);
        }
      });
    };

    const reset = () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      node.style.setProperty("--tilt-x", "0deg");
      node.style.setProperty("--tilt-y", "0deg");
      node.style.removeProperty("--px");
      node.style.removeProperty("--py");
    };

    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerleave", reset);

    return () => {
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerleave", reset);
      cancelAnimationFrame(frame.current);
    };
  }, [tilt, reduced]);

  return ref;
}

/**
 * Animate a number from its previous value to `value`.
 *
 * Uses an eased rAF loop rather than a CSS transition because the *text* has to
 * change, not just a transform. Jumps straight to the target when motion is
 * reduced, and when the change is trivially small.
 */
export function useCountUp(value, { duration = 900, decimals = 0 } = {}) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const from = fromRef.current;

    if (reduced || from === target || Math.abs(target - from) < 1) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }

    const started = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      // easeOutExpo: fast start, long settle — reads as "counting up".
      const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);

      setShown(from + (target - from) * eased);

      if (progress < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration, reduced]);

  return decimals ? Number(shown.toFixed(decimals)) : Math.round(shown);
}

/**
 * Reveal an element the first time it scrolls into view.
 *
 * One-shot: it disconnects after firing, so scrolling back up does not replay
 * the animation (which reads as a glitch rather than a flourish).
 */
export function useReveal({ threshold = 0.15, rootMargin = "0px 0px -40px 0px" } = {}) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setRevealed(true);
      return undefined;
    }

    const node = ref.current;
    if (!node) return undefined;

    // Already on screen at mount: reveal without waiting for a scroll.
    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, reduced]);

  return [ref, revealed];
}

/**
 * Run a DOM update inside a View Transition when the browser supports one.
 *
 * Progressive enhancement: unsupported browsers and reduced-motion users get
 * the same update, just without the crossfade.
 */
export function withViewTransition(update) {
  if (typeof document === "undefined" || !document.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(() => update());
}

/**
 * Briefly flag an element as "just changed" so CSS can pulse it.
 * @returns {[boolean, () => void]}
 */
export function usePulse(duration = 700) {
  const [pulsing, setPulsing] = useState(false);
  const timer = useRef(0);

  const pulse = useCallback(() => {
    clearTimeout(timer.current);
    setPulsing(true);
    timer.current = setTimeout(() => setPulsing(false), duration);
  }, [duration]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return [pulsing, pulse];
}
