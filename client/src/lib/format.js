/** Presentation helpers. Pure functions, no React. */

/**
 * Label for a usage gauge that is animating from 0 up to `target`.
 *
 * Rounding is the whole problem: 2.6 KB inside a 2 GB quota really is 0.0001%,
 * and printing "0.0%" invites the reader to decide the number is broken rather
 * than tiny. Anything present but under a tenth of a percent is reported as
 * such, and only a genuinely empty quota shows a flat zero.
 *
 * @param {number} target   the real percentage, 0–100
 * @param {number} animated the value currently being displayed mid-animation
 */
/**
 * Can this document be shown, and compared, as text?
 *
 * One definition, used by the preview and by version comparison. It was inlined
 * in the preview; a second copy in the diff would have been free to disagree
 * about, say, SVG — and then a file would preview as text but refuse to diff.
 *
 * JSON and XML are text that browsers label as `application/*`, which is why the
 * check is not simply "starts with text/".
 */
export function isTextDocument(doc) {
  const mimeType = doc?.file?.mimeType || doc?.mimeType || "";
  return /^text\/|^application\/(json|xml|xhtml\+xml)|\+xml$/.test(mimeType);
}

export function formatUsagePercent(target, animated = target) {
  if (!Number.isFinite(target) || target <= 0) return "0%";
  if (target < 0.1) return "<0.1%";

  const shown = Number.isFinite(animated) ? Math.max(0, Math.min(target, animated)) : target;
  return `${shown.toFixed(shown < 10 ? 1 : 0)}%`;
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

/** 1_240 -> "1.2k". Keeps metric tiles from wrapping. */
export function compactNumber(value = 0) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const formatNumber = (value = 0) => new Intl.NumberFormat().format(Number(value) || 0);

const RELATIVE_STEPS = [
  { limit: 45, divisor: 1, unit: "second" },
  { limit: 45 * 60, divisor: 60, unit: "minute" },
  { limit: 22 * 3600, divisor: 3600, unit: "hour" },
  { limit: 26 * 86400, divisor: 86400, unit: "day" },
  { limit: 320 * 86400, divisor: 30 * 86400, unit: "month" },
  { limit: Infinity, divisor: 365 * 86400, unit: "year" },
];

/** "3 minutes ago" / "in 2 days" */
export function relativeTime(input) {
  if (!input) return "—";
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return "—";

  const seconds = (then - Date.now()) / 1000;
  const magnitude = Math.abs(seconds);

  if (magnitude < 8) return "just now";

  const step = RELATIVE_STEPS.find((candidate) => magnitude < candidate.limit) ?? RELATIVE_STEPS.at(-1);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(Math.round(seconds / step.divisor), step.unit);
}

export function formatDate(input, { withTime = false } = {}) {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatDayLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human label for a document category. */
export const categoryLabel = (category) =>
  ({
    pdf: "PDF",
    document: "Document",
    spreadsheet: "Spreadsheet",
    presentation: "Presentation",
    image: "Image",
    archive: "Archive",
    audio: "Audio",
    video: "Video",
    code: "Code",
    other: "Other",
  })[category] || "Other";

/** CSS colour token for a category, used by charts and legends. */
export const categoryColor = (category) =>
  ({
    pdf: "#fb7185",
    document: "#7dd3fc",
    spreadsheet: "#34d399",
    presentation: "#fbbf24",
    image: "#c084fc",
    archive: "#fca5a5",
    audio: "#f0abfc",
    video: "#67e8f9",
    code: "#a5b4fc",
    other: "#8ea0cf",
  })[category] || "#8ea0cf";

export const visibilityLabel = (visibility) =>
  ({ private: "Private", internal: "Team", public: "Public" })[visibility] || visibility;

export const visibilityHint = (visibility) =>
  ({
    private: "Only you and people you share it with",
    internal: "Any signed-in member can view it",
    public: "Anyone who has the link or id can view it",
  })[visibility] || "";

export const permissionLabel = (permission) =>
  ({ view: "Can view", edit: "Can edit", manage: "Can manage" })[permission] || permission;

/** Initials for an avatar, from a full name or an email address. */
export function initialsOf(value = "") {
  const source = String(value).trim();
  if (!source) return "?";

  if (source.includes("@")) return source.slice(0, 2).toUpperCase();

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
}

/** Pick a token for a storage gauge based on how full it is. */
export const usageTone = (percent) => (percent >= 90 ? "danger" : percent >= 70 ? "warning" : "ok");

export const pluralize = (count, singular, plural) =>
  `${formatNumber(count)} ${count === 1 ? singular : plural || `${singular}s`}`;

/**
 * Label for the platform's modifier key.
 * Showing "⌘" to a Windows or Linux user is simply wrong, and the glyph is
 * missing from many non-Apple font stacks.
 */
export function modifierKeyLabel() {
  if (typeof navigator === "undefined") return "Ctrl";
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}

/** Copy text, preferring the async clipboard API with a legacy fallback. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
