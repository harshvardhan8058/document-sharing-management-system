/**
 * Colour contrast maths, per WCAG 2.1.
 *
 * Lives in a plain `.js` module so `node --test` can hold the palette to a
 * standard instead of trusting a hand review. Contrast is the one part of visual
 * design that is not a matter of taste: either the ratio clears the threshold or
 * the text is hard to read, and the light theme drifted below it unnoticed
 * because nothing was checking.
 */

/** Parse `#rgb`, `#rrggbb` or `rgb()/rgba()` into `[r, g, b]` 0–255. */
export function parseColor(value) {
  const input = String(value).trim();

  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgb = input.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  throw new Error(`cannot parse colour: ${value}`);
}

/**
 * Flatten a translucent colour onto an opaque backdrop.
 *
 * Half the palette is `rgba(...)` over a surface, and judging those by their own
 * channels would be meaningless — a 14%-alpha border is not the colour it
 * declares.
 */
export function flatten(foreground, alpha, backdrop) {
  const [fr, fg, fb] = parseColor(foreground);
  const [br, bg, bb] = parseColor(backdrop);
  const mix = (f, b) => f * alpha + b * (1 - alpha);
  return [mix(fr, br), mix(fg, bg), mix(fb, bb)];
}

/** Relative luminance, per WCAG. */
export function luminance(color) {
  const [r, g, b] = (Array.isArray(color) ? color : parseColor(color)).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1–21. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG thresholds.
 *
 * `large` is 18.66px bold or 24px regular. UI components (borders, icon strokes,
 * focus rings) have their own lower bar under 1.4.11 Non-text Contrast.
 */
export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;

/** Does this pair clear the given threshold? */
export function meetsContrast(foreground, background, threshold = AA_TEXT) {
  return contrastRatio(foreground, background) >= threshold;
}

/** Ratio rounded the way a report should show it. */
export function ratio(foreground, background) {
  return Math.round(contrastRatio(foreground, background) * 100) / 100;
}
