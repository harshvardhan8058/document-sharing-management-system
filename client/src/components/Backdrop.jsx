import { useEffect, useRef } from "react";
import { useReducedMotion } from "../lib/useMotion";

/**
 * The animated backdrop: drifting aurora blobs over a perspective grid, with a
 * film-grain overlay and a slow pointer parallax.
 *
 * Parallax is written as CSS custom properties on a single container rather than
 * as React state — the pointer fires constantly and re-rendering here would cost
 * frames for a purely decorative effect. Motion stops entirely under
 * `prefers-reduced-motion`, leaving the static gradient.
 *
 * Hidden from assistive technology: it carries no information.
 */
export default function Backdrop() {
  const ref = useRef(null);
  const frame = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return undefined;

    const onPointerMove = (event) => {
      if (frame.current) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        // -1..1 from the centre of the viewport, damped hard so the movement
        // reads as depth rather than as the background chasing the cursor.
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        node.style.setProperty("--parallax-x", `${(x * 18).toFixed(2)}px`);
        node.style.setProperty("--parallax-y", `${(y * 18).toFixed(2)}px`);
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame.current);
    };
  }, [reduced]);

  return (
    <div className="backdrop" aria-hidden="true" ref={ref}>
      <div className="backdrop__grid" />
      <div className="backdrop__blob backdrop__blob--1" />
      <div className="backdrop__blob backdrop__blob--2" />
      <div className="backdrop__blob backdrop__blob--3" />
      <div className="backdrop__beam" />
      <div className="backdrop__grain" />
    </div>
  );
}
