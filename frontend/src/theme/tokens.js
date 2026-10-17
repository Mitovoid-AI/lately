// Theme tokens from the Stitch "Warm Editorial Media" design system: "Warm Cream" (light) and
// "Espresso" (dark). tailwind.config.js turns each colour into a CSS variable, so className and
// inline styles (via useTheme) share one source.
const light = {
  canvas: "#FAF8F5",
  card: "#FFFEFB",
  raised: "#F4EFEA",
  hairline: "#E7E1D8",
  ink: "#1C1A17",
  ink2: "#6B655D",
  ink3: "#9B948A",
  accent: "#D98A0B",
  onAccent: "#FFFFFF",
  accentPressed: "#C27A08",
  success: "#2E7D52",
  danger: "#D32F2F",
  dangerSoft: "#FDE2E1",
  dangerPressed: "#F9CFCD",
  /** Accent as text on canvas/card: the marigold darkened to pass 4.5:1 contrast. */
  accentText: "#8A5300",
  /** Warm neutral chip (membership badge). */
  warm: "#EFE3D3",
  /** Text and glyphs over photos and dark scrims. */
  onMedia: "#FFFFFF",
  /** Dark pill or overlay over photos. */
  scrim: "rgba(28,26,23,0.55)",
  /** Light pill over photos (category badge). */
  scrimLight: "rgba(255,254,251,0.9)",
  /** Hairline around a pill sitting on a photo. */
  mediaHairline: "rgba(255,255,255,0.35)",
  /** Sheet and dialog backdrop. */
  backdrop: "rgba(28,26,23,0.35)",
  /** Focus ring around inputs. */
  focusRing: "rgba(217,138,11,0.2)",
  /** A category dot on an active (marigold) chip. */
  onAccentDot: "rgba(255,255,255,0.85)",
  /** Google's own blue, for its logo only. */
  google: "#4285F4",
};

/**
 * Espresso: warm roasted browns instead of grey-black, cream ink, the same marigold family.
 * Text on canvas, card and raised clears 4.5:1 (ink 13:1+, ink-2 6.3:1+, ink-3 4.5:1+,
 * accent-text 7.9:1+). Labels on marigold switch to near-black, since white on a lit accent
 * reads weak on a dark screen.
 */
const dark = {
  canvas: "#15120F",
  card: "#1E1A16",
  raised: "#29241E",
  hairline: "#3A332B",
  ink: "#F2ECE3",
  ink2: "#B0A597",
  ink3: "#958A7D",
  accent: "#E0961F",
  onAccent: "#1A1208",
  accentPressed: "#C98516",
  success: "#6CC293",
  danger: "#F2766E",
  dangerSoft: "#3B201D",
  dangerPressed: "#4A2824",
  accentText: "#F0AE4A",
  warm: "#3A2D1C",
  onMedia: "#FFFFFF",
  scrim: "rgba(16,13,10,0.6)",
  /** The category badge stays a pill over photos, but an espresso one. */
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
 * web alike; the old shadow* props were iOS-only and invisible on Android). Dark surfaces get
 * deeper, neutral shadows: a warm 7% shadow disappears on espresso.
 */
const shadowSets = {
  light: {
    /** Resting cards and controls. */
    card: "0px 1px 3px rgba(28,26,23,0.07)",
    /** Things that sit above content: chips on media, slider thumbs. */
    raised: "0px 2px 6px rgba(28,26,23,0.12)",
    /** Hero media and floating surfaces. */
    overlay: "0px 10px 24px rgba(28,26,23,0.18)",
    /** The floating paste button: a marigold glow. */
    accent: "0px 6px 16px rgba(217,138,11,0.32)",
  },
  dark: {
    card: "0px 1px 3px rgba(0,0,0,0.4)",
    raised: "0px 2px 6px rgba(0,0,0,0.45)",
    overlay: "0px 10px 24px rgba(0,0,0,0.55)",
    accent: "0px 6px 16px rgba(224,150,31,0.22)",
  },
};

/** The skeleton shimmer band: a card-coloured glint on light, a faint cream one on espresso. */
const sheens = {
  light: "linear-gradient(90deg, rgba(255,254,251,0) 0%, rgba(255,254,251,0.75) 50%, rgba(255,254,251,0) 100%)",
  dark: "linear-gradient(90deg, rgba(242,236,227,0) 0%, rgba(242,236,227,0.07) 50%, rgba(242,236,227,0) 100%)",
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

module.exports = { palettes, shadowSets, sheens, cssName, cssVariables };
