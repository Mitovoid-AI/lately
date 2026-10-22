// Theme tokens: "Daylight" (light: white, a warm grey for raised surfaces, marigold the one
// accent) and "Espresso" (dark). tailwind.config.js turns each colour into a CSS variable, so
// className and inline styles (via useTheme) share one source.

/**
 * Daylight: white canvas and cards (a hairline, not a tint, separates them), warm-grey raised
 * surfaces, near-black ink. Marigold is a fill, never text or a glyph on white (2.4:1): labels on
 * it are near-black, text in its hue uses accent-text. Measured WCAG ratios, rounded down
 * (canvas / card / raised; warm is a fourth surface where text sits on it):
 *   ink 18.5 / 18.5 / 16.5 (warm 16.3)        ink-2 7.3 / 7.3 / 6.5 (warm 6.4)
 *   ink-3 5.1 / 5.1 / 4.6 (warm 4.5)
 *   accent-text 5.9 / 5.9 / 5.3 (warm 5.2)    success 5.7 / 5.7 / 5.1 (warm 5.0)
 *   danger 6.4 / 6.4 / 5.7 (warm 5.6)
 *   on-accent on accent 7.8, on accent-pressed 6.1   on-success on success 5.7
 *   danger on danger-soft 5.2, on danger-pressed 4.6
 *   control (input, checkbox and secondary-button outlines; 3:1 needed) 3.5 / 3.5 / 3.1
 *   white text on the scrim, over a pure-white photo 4.8
 * Hairline (1.3:1) only separates; nothing relies on it to be found.
 */
const light = {
  canvas: "#FFFFFF",
  card: "#FFFFFF",
  raised: "#F4F2EE",
  hairline: "#E2DED6",
  /** Outline of an input, checkbox or secondary button: the boundary of a control (3:1). */
  control: "#8E8880",
  ink: "#15130F",
  ink2: "#5C554A",
  ink3: "#726C64",
  accent: "#E39A1E",
  /** Label or glyph on the accent: near-black, 7.8:1 (white on this marigold is 2.4:1). */
  onAccent: "#1A1208",
  accentPressed: "#CC8612",
  success: "#26744A",
  /** Glyph on a success fill (the saved tick). */
  onSuccess: "#FFFFFF",
  danger: "#B91F1F",
  dangerSoft: "#FCE4E2",
  dangerPressed: "#F8D3D0",
  /** Accent as text on canvas/card/raised: the marigold darkened to pass 4.5:1 contrast. */
  accentText: "#8F5700",
  /** Marigold-tinted chip (membership badge, plan percent). */
  warm: "#FCEFD9",
  /** Text and glyphs over photos and dark scrims. */
  onMedia: "#FFFFFF",
  /** Secondary text over photos and dark scrims (a tile's note and meta). */
  onMediaMuted: "rgba(255,255,255,0.82)",
  /** Dark pill or overlay over photos. */
  scrim: "rgba(21,19,15,0.6)",
  /** Light pill over photos. */
  scrimLight: "rgba(255,255,255,0.92)",
  /** Hairline around a pill sitting on a photo. */
  mediaHairline: "rgba(255,255,255,0.35)",
  /** Sheet and dialog backdrop. */
  backdrop: "rgba(21,19,15,0.4)",
  /** Soft halo around a focused input. */
  focusRing: "rgba(227,154,30,0.24)",
  /** A category dot on an active (marigold) chip. */
  onAccentDot: "rgba(26,18,8,0.7)",
  /** Google's own blue, for its logo only. */
  google: "#4285F4",
};

/**
 * Espresso: warm roasted browns instead of grey-black, cream ink, the same marigold family.
 * Text on canvas, card and raised clears 4.5:1 (ink 13.1:1+, ink-2 6.3:1+, ink-3 4.5:1+,
 * accent-text 7.9:1+, success 7.1:1+, danger 5.5:1+; ink-3 is not set on warm, 3.9 there).
 * Labels on marigold are near-black in both themes (7.5:1 on accent, 6.0:1 on accent-pressed);
 * danger on danger-soft 5.3:1, on danger-pressed 4.6:1; on-success on success 7.6:1; control
 * outlines 3.8 / 3.5 / 3.1 (canvas / card / raised).
 */
const dark = {
  canvas: "#15120F",
  card: "#1E1A16",
  raised: "#29241E",
  hairline: "#3A332B",
  control: "#7A7064",
  ink: "#F2ECE3",
  ink2: "#B0A597",
  ink3: "#958A7D",
  accent: "#E0961F",
  onAccent: "#1A1208",
  accentPressed: "#C98516",
  success: "#6CC293",
  onSuccess: "#0E2418",
  danger: "#F2766E",
  dangerSoft: "#3B201D",
  dangerPressed: "#4A2824",
  accentText: "#F0AE4A",
  warm: "#3A2D1C",
  onMedia: "#FFFFFF",
  onMediaMuted: "rgba(255,255,255,0.82)",
  scrim: "rgba(16,13,10,0.6)",
  /** A light pill over photos, in espresso. */
  scrimLight: "rgba(30,26,22,0.88)",
  mediaHairline: "rgba(255,255,255,0.25)",
  backdrop: "rgba(0,0,0,0.55)",
  focusRing: "rgba(224,150,31,0.28)",
  onAccentDot: "rgba(26,18,8,0.7)",
  google: "#4285F4",
};

const palettes = { light, dark };

/**
 * Elevation, as CSS box-shadow strings (React Native's boxShadow renders on iOS, Android and
 * web alike; the old shadow* props were iOS-only and invisible on Android). On white they are
 * light and neutral; dark surfaces get deeper ones, since a 6% shadow disappears on espresso.
 */
const shadowSets = {
  light: {
    /** Resting cards and controls. */
    card: "0px 1px 2px rgba(21,19,15,0.06)",
    /** Things that sit above content: chips on media, slider thumbs. */
    raised: "0px 2px 6px rgba(21,19,15,0.1)",
    /** Hero media and floating surfaces. */
    overlay: "0px 10px 24px rgba(21,19,15,0.14)",
    /** A floating action button: a plain lift (the marigold glow is gone). */
    accent: "0px 4px 12px rgba(21,19,15,0.16)",
  },
  dark: {
    card: "0px 1px 3px rgba(0,0,0,0.4)",
    raised: "0px 2px 6px rgba(0,0,0,0.45)",
    overlay: "0px 10px 24px rgba(0,0,0,0.55)",
    accent: "0px 6px 16px rgba(0,0,0,0.5)",
  },
};

/** The skeleton shimmer band: a white glint on light, a faint cream one on espresso. */
const sheens = {
  light: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0) 100%)",
  dark: "linear-gradient(90deg, rgba(242,236,227,0) 0%, rgba(242,236,227,0.07) 50%, rgba(242,236,227,0) 100%)",
};

/**
 * Gradients laid over photos so text on them stays readable. Media scrims are the same in both
 * themes: the photo, not the theme, sets what sits under the text.
 */
const tileScrim = "linear-gradient(180deg, rgba(0,0,0,0) 25%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.82) 100%)";
const scrims = {
  /**
   * A card tile: clear over the top quarter (the category pill), already dark by the middle
   * where a two-line title starts, darkest at the bottom.
   */
  tile: { light: tileScrim, dark: tileScrim },
};

/** The Tailwind colour name for each token (`ink2` is `ink-2` in classNames). */
function cssName(token) {
  return token.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
}

/** "#FAF8F5" → "250 248 245", the form `rgb(var(--x) / <alpha-value>)` needs; rgba stays as is. */
function cssValue(value) {
  if (!value.startsWith("#")) return value;
  const h = value.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
}

/** A palette as CSS custom properties: { "--color-ink-2": "107 101 93", ... }. */
function cssVariables(palette) {
  return Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--color-${cssName(k)}`, cssValue(v)]));
}

module.exports = { palettes, shadowSets, sheens, scrims, cssName, cssVariables };
