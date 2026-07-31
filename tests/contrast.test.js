"use strict";

/**
 * The palette, held to WCAG contrast ratios.
 *
 * Contrast is the one part of visual design that is not a matter of taste, and
 * it is the part that drifts silently: the light theme shipped with a "TEAM"
 * badge and file-type glyphs that were close to invisible, because the variants
 * hardcoded colours chosen against a near-black background.
 *
 * The pairs below are read out of `tokens.css` itself rather than copied, so the
 * test tracks the stylesheet instead of a snapshot of it. Changing a token to
 * something unreadable fails here.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const TOKENS_FILE = path.join(__dirname, "..", "client", "src", "styles", "tokens.css");

let contrast;
let themes;

test.before(async () => {
  contrast = await import("../client/src/lib/contrast.js");
  themes = readThemes(fs.readFileSync(TOKENS_FILE, "utf8"));
});

/**
 * Pull custom properties out of the `:root` and `[data-theme="daybreak"]` blocks.
 *
 * The light theme is an override layer, so its effective palette is the dark one
 * with its own declarations applied on top — exactly how the cascade resolves it.
 */
function readThemes(css) {
  const block = (selector) => {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
    const open = css.indexOf("{", start);
    const close = css.indexOf("\n}", open);
    return css.slice(open, close);
  };

  const declarations = (text) => {
    const out = {};
    for (const [, name, value] of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      out[name.trim()] = value.trim();
    }
    return out;
  };

  const nebula = declarations(block(":root {"));
  const daybreak = { ...nebula, ...declarations(block(':root[data-theme="daybreak"]')) };
  return { nebula, daybreak };
}

/** Resolve a token to a colour, following `var()` indirection. */
function resolve(theme, token, depth = 0) {
  const raw = typeof token === "string" && token.startsWith("--") ? theme[token.slice(2)] : token;
  if (raw === undefined) throw new Error(`unknown token: ${token}`);
  if (depth > 5) throw new Error(`var() loop resolving ${token}`);

  const reference = String(raw).match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  return reference ? resolve(theme, reference[1], depth + 1) : raw;
}

/**
 * Effective colour of a possibly translucent value composited over a backdrop.
 * `rgba(...)` tokens are meaningless judged on their own channels.
 */
function effective(theme, value, backdropToken) {
  const colour = resolve(theme, value);
  const backdrop = resolve(theme, backdropToken);

  const rgba = String(colour).match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,/]+([\d.]+)\s*\)$/i);
  if (!rgba) return colour;

  return contrast.flatten(`rgb(${rgba[1]},${rgba[2]},${rgba[3]})`, Number(rgba[4]), backdrop);
}

function check(theme, themeName, foreground, background, threshold, label) {
  const fg = effective(theme, foreground, background);
  const bg = resolve(theme, background);
  const value = contrast.ratio(fg, bg);

  assert.ok(
    value >= threshold,
    `${themeName}: ${label} is ${value}:1, needs ${threshold}:1 ` +
      `(${JSON.stringify(foreground)} on ${JSON.stringify(background)})`
  );
  return value;
}

const forEachTheme = (fn) => {
  fn(themes.nebula, "Nebula (dark)");
  fn(themes.daybreak, "Daybreak (light)");
};

test("body text clears AA on every surface it can sit on", () => {
  const { AA_TEXT } = contrast;

  forEachTheme((theme, name) => {
    for (const surface of ["--void", "--abyss", "--surface-0", "--surface-1", "--surface-2", "--surface-3"]) {
      check(theme, name, "--text", surface, AA_TEXT, `--text on ${surface}`);
    }
  });
});

test("secondary and tertiary text clear AA on the surfaces they appear on", () => {
  const { AA_TEXT } = contrast;

  forEachTheme((theme, name) => {
    for (const surface of ["--void", "--surface-0", "--surface-1", "--surface-2"]) {
      // Both are used at ordinary sizes — captions, metadata, table cells — so
      // the small-text exemption does not apply to them.
      check(theme, name, "--text-muted", surface, AA_TEXT, `--text-muted on ${surface}`);
      check(theme, name, "--text-dim", surface, AA_TEXT, `--text-dim on ${surface}`);
    }
  });
});

test("visibility badges are readable in both themes", () => {
  const { AA_TEXT } = contrast;

  // Each badge is coloured text on a translucent tint over a panel. These are
  // the ones that failed: "TEAM" and the violet variant hardcoded pale colours
  // picked against a near-black background.
  const badges = [
    ["--badge-neutral-fg", "--badge-neutral-bg"],
    ["--badge-info-fg", "--badge-info-bg"],
    ["--badge-success-fg", "--badge-success-bg"],
    ["--badge-warning-fg", "--badge-warning-bg"],
    ["--badge-danger-fg", "--badge-danger-bg"],
    ["--badge-accent-fg", "--badge-accent-bg"],
    ["--badge-violet-fg", "--badge-violet-bg"],
  ];

  forEachTheme((theme, name) => {
    for (const [fg, bg] of badges) {
      const tint = effective(theme, bg, "--surface-1");
      const value = contrast.ratio(effective(theme, fg, bg), tint);
      assert.ok(value >= AA_TEXT, `${name}: ${fg} on ${bg} is ${value}:1, needs ${AA_TEXT}:1`);
    }
  });
});

test("file-type letters are legible on their tile in both themes", () => {
  const { AA_TEXT } = contrast;

  /*
   * The extension shown on a glyph ("PDF", "CSV") is small bold text on
   * `--surface-2`, so it answers to the normal-text threshold. Every one of
   * these was hardcoded for a near-black tile and failed once the tile turned
   * pale — `--glyph-video` measured 1.28:1, effectively invisible.
   */
  const glyphs = [
    "--glyph-pdf",
    "--glyph-document",
    "--glyph-spreadsheet",
    "--glyph-presentation",
    "--glyph-image",
    "--glyph-archive",
    "--glyph-audio",
    "--glyph-video",
    "--glyph-code",
  ];

  forEachTheme((theme, name) => {
    for (const glyph of glyphs) {
      check(theme, name, glyph, "--surface-2", AA_TEXT, `${glyph} on the glyph tile`);
    }
  });
});

test("accent text is readable, not just decorative", () => {
  const { AA_TEXT } = contrast;

  forEachTheme((theme, name) => {
    // The accent is used for values and links, not only for glows.
    check(theme, name, "--accent-text", "--surface-1", AA_TEXT, "--accent-text on --surface-1");
    check(theme, name, "--accent-text", "--surface-2", AA_TEXT, "--accent-text on --surface-2");
  });
});

test("control boundaries and the focus ring clear the non-text threshold", () => {
  const { AA_NON_TEXT } = contrast;

  /*
   * WCAG 1.4.11 covers "visual information required to identify user interface
   * components and states" — the edge of a text input, the ring showing what is
   * focused. It does not cover decoration, so `--line` and `--line-strong` stay
   * as hairlines that group panels; forcing those to 3:1 would draw a box around
   * everything on the page to satisfy a rule that was never about them.
   */
  forEachTheme((theme, name) => {
    for (const surface of ["--surface-1", "--surface-2"]) {
      check(theme, name, "--border-control", surface, AA_NON_TEXT, `--border-control on ${surface}`);
    }
    for (const surface of ["--surface-0", "--surface-1", "--surface-2", "--surface-3"]) {
      check(theme, name, "--focus-ring", surface, AA_NON_TEXT, `--focus-ring on ${surface}`);
    }
  });
});

test("the contrast helper itself is right", () => {
  const { contrastRatio, ratio, parseColor, flatten, meetsContrast, AA_TEXT } = contrast;

  // The two anchors every implementation must agree on.
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);

  // A known value: WebAIM reports 4.54:1 for #767676 on white.
  assert.equal(ratio("#767676", "#ffffff"), 4.54);
  assert.ok(meetsContrast("#767676", "#ffffff", AA_TEXT));
  assert.ok(!meetsContrast("#777777", "#ffffff", 4.6));

  // Shorthand hex and rgb() forms.
  assert.deepEqual(parseColor("#fff"), [255, 255, 255]);
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), [10, 20, 30]);
  assert.deepEqual(parseColor("rgba(10 20 30 / 0.5)"), [10, 20, 30]);

  // Compositing: half-opacity black over white is mid grey.
  assert.deepEqual(flatten("#000000", 0.5, "#ffffff"), [127.5, 127.5, 127.5]);
  // Fully transparent leaves the backdrop untouched.
  assert.deepEqual(flatten("#000000", 0, "#ffffff"), [255, 255, 255]);

  assert.throws(() => parseColor("chartreuse"), /cannot parse/);
});
