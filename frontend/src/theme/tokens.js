// Light theme tokens from the Stitch "Warm Editorial Media" design system.
// tailwind.config.js reads these so className and inline styles share one source.
const colors = {
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
 * Elevation, as CSS box-shadow strings (React Native's boxShadow renders on iOS, Android and
 * web alike; the old shadow* props were iOS-only and invisible on Android).
 */
const shadows = {
  /** Resting cards and controls. */
  card: "0px 1px 3px rgba(28,26,23,0.07)",
  /** Things that sit above content: chips on media, slider thumbs. */
  raised: "0px 2px 6px rgba(28,26,23,0.12)",
  /** Hero media and floating surfaces. */
  overlay: "0px 10px 24px rgba(28,26,23,0.18)",
  /** The floating paste button: a marigold glow. */
  accent: "0px 6px 16px rgba(217,138,11,0.32)",
};

/** The skeleton shimmer band, built from the card colour. */
const sheen = "linear-gradient(90deg, rgba(255,254,251,0) 0%, rgba(255,254,251,0.75) 50%, rgba(255,254,251,0) 100%)";

module.exports = { colors, shadows, sheen };
