/**
 * Decorative background: drifting aurora blobs, a perspective grid and film
 * grain. Fixed behind everything at z-index -1 and hidden from assistive
 * technology — it carries no information.
 */
export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop__grid" />
      <div className="backdrop__blob backdrop__blob--1" />
      <div className="backdrop__blob backdrop__blob--2" />
      <div className="backdrop__blob backdrop__blob--3" />
      <div className="backdrop__grain" />
    </div>
  );
}
