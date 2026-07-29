/**
 * Path helpers, kept in a plain `.js` module so they can be unit tested by
 * `node --test` without a JSX transform. `router.jsx` re-exports them.
 */

/**
 * Coerce a navigation destination into a safe, internal path.
 *
 * This is the single defence against open redirects. `//evil.com` is a
 * scheme-relative URL, and browsers normalise backslashes to slashes in several
 * positions, so `\\evil.com` and `/\evil.com` are equally dangerous — that
 * backslash trick is the published React Router advisory this router replaces.
 * Anything that could leave the origin collapses to "/".
 */
export function normalizeTo(to) {
  if (typeof to !== "string" || to === "") return "/";

  const candidate = to.replace(/\\/g, "/");

  // Absolute URLs (http:, javascript:, data:, ...) are never internal.
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate)) return "/";
  // Scheme-relative: //host/path
  if (candidate.startsWith("//")) return "/";
  if (!candidate.startsWith("/")) return `/${candidate}`;

  return candidate;
}

/**
 * Match a route pattern such as `/documents/:id` or `/settings/*` against a
 * pathname.
 *
 * @returns {object|null} captured params, or null when the pattern does not match
 */
export function matchPath(pattern, pathname) {
  if (pattern === "*") return {};

  const patternParts = pattern.split("/").filter(Boolean);

  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    // A malformed escape sequence should not throw during render.
  }
  const pathParts = decoded.split("/").filter(Boolean);

  const params = {};

  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];

    if (expected === "*") return params; // catch-all consumes the remainder

    const actual = pathParts[index];
    if (actual === undefined) return null;

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }

  // Reject extra trailing segments unless the pattern ended in a catch-all.
  if (pathParts.length > patternParts.length) return null;

  return params;
}
