/**
 * Icon set — one component, a map of path data.
 *
 * All glyphs are drawn on a 24x24 grid with `currentColor` strokes, so they
 * inherit colour and optical weight from whatever they sit inside. Bundled
 * inline (no sprite request, no icon package).
 */

const PATHS = {
  // navigation
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  files: "M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z",
  file: "M7 3h7l5 5v13H7V3Zm7 0v5h5",
  share: "M18 8a3 3 0 1 0-2.83-4M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9",
  star: "M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8L12 3.6Z",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v6m4-6v6",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  settings:
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8-3.2c0-.6-.06-1.2-.17-1.75l2-1.2-2-3.46-2 1.15A8 8 0 0 0 15.8 5.2L15.4 3h-4l-.4 2.2c-.72.24-1.4.6-2 1.05l-2-1.15-2 3.46 2 1.2c-.11.55-.17 1.15-.17 1.75s.06 1.2.17 1.75l-2 1.2 2 3.46 2-1.15c.6.45 1.28.81 2 1.05l.4 2.2h4l.4-2.2c.72-.24 1.4-.6 2-1.05l2 1.15 2-3.46-2-1.2c.11-.55.17-1.15.17-1.75Z",
  shield: "M12 3l8 3v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6l8-3Z",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8v-1.5a3.5 3.5 0 0 0-2.6-3.38M15.5 4.13a3.5 3.5 0 0 1 0 6.74",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2",

  // actions
  upload: "M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V17",
  download: "M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V17",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.5-1.5L21 21",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 13l4.5 4.5L19 7",
  edit: "M4 20h4L20 8l-4-4L4 16v4Zm11-13 3 3",
  copy: "M9 9V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3M6 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 5.34l-1.5 1.5M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1.5-1.5",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z",
  lock: "M6 11h12v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-9Zm2 0V8a4 4 0 0 1 8 0v3",
  unlock: "M6 11h12v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-9Zm2 0V8a4 4 0 0 1 7.5-2",
  logout: "M15 17l4-5-4-5m4 5H9m2 8H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5",
  refresh: "M20 11a8 8 0 1 0-2.4 5.7M20 5v6h-6",
  filter: "M4 6h16M7 12h10M10 18h4",
  restore: "M4 13a8 8 0 1 0 2.4-5.7M4 7v6h6",
  more: "M12 7.5h.01M12 12h.01M12 16.5h.01",
  external: "M14 5h5v5m0-5-7 7M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4",
  command: "M9 3a3 3 0 1 1-3 3h12a3 3 0 1 1-3-3v12a3 3 0 1 0 3 3H6a3 3 0 1 0 3-3V3Z",
  menu: "M4 7h16M4 12h16M4 17h16",
  grid: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
  list: "M4 6h16M4 12h16M4 18h16",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 18v-2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  chevronLeft: "M14.5 6.5 9 12l5.5 5.5",
  chevronRight: "M9.5 6.5 15 12l-5.5 5.5",
  chevronDown: "M6.5 9.5 12 15l5.5-5.5",
  chevronUp: "M6.5 14.5 12 9l5.5 5.5",
  arrowRight: "M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5",
  history: "M12 8v4.5l3 1.8M3.5 12A8.5 8.5 0 1 1 6 18M3 13v-5h5",

  // feedback
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1",
  alert: "M12 9v5m0 3h.01M10.3 4.3 2.6 18a1.5 1.5 0 0 0 1.3 2.2h16.2a1.5 1.5 0 0 0 1.3-2.2L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.5-9.2 2.6 2.6 4.4-4.8",
  spark: "M12 3v3m0 12v3M4.2 7.2l2.1 2.1m11.4 5.4 2.1 2.1M3 12h3m12 0h3M4.2 16.8l2.1-2.1m11.4-5.4 2.1-2.1",
};

/** Category glyphs get their own map so `<FileGlyph>` can look them up. */
export const CATEGORY_ICON = {
  pdf: "file",
  document: "file",
  spreadsheet: "grid",
  presentation: "dashboard",
  image: "eye",
  archive: "files",
  audio: "spark",
  video: "eye",
  code: "command",
  other: "file",
};

export function Icon({ name, size = 16, strokeWidth = 1.7, className = "", title, ...rest }) {
  const path = PATHS[name];
  if (!path) {
    if (import.meta.env.DEV) console.warn(`Icon "${name}" is not defined`);
    return null;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}

/** The product mark: a document outline with a gradient stroke. */
export function BrandMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dsms-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="55%" stopColor="#5b8cff" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path
        d="M6.5 3.5h7l4.5 4.5v12.5h-11.5V3.5Z"
        stroke="url(#dsms-brand)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M13.5 3.5v5h4.5" stroke="url(#dsms-brand)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 13h6M9 16.5h4" stroke="url(#dsms-brand)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
