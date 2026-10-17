import { Easing } from "react-native-reanimated";

/**
 * Motion tokens. Every animation in the app draws its curve, duration and spring from here,
 * so motion feels related from screen to screen. Keep UI motion under 300 ms; navigation uses
 * the platform's own transitions.
 */

/** Strong ease-out: entering, exiting and press feedback. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** On-screen movement (an indicator sliding between tabs). */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** The iOS sheet curve. */
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);

export const DURATION = {
  /** Press-in feedback. */
  press: 110,
  /** Toggles, chips, focus rings, small state changes. */
  state: 180,
  /** Content entering. */
  enter: 280,
  /** Content leaving (~20% faster than entering). */
  exit: 200,
  /** Sheets and dialogs. */
  sheet: 300,
} as const;

/** Springs use the duration / dampingRatio form, never mass/stiffness. */
export const SPRING = {
  /** Release after a press: settles with a whisper of give. */
  release: { duration: 320, dampingRatio: 0.8 },
  /** Settle with no overshoot. */
  settle: { duration: 400, dampingRatio: 1 },
  /** A sheet snapping home after a drag (pass the finger's velocity). */
  sheet: { duration: 300, dampingRatio: 0.8 },
  /** A success mark landing: the delight budget, used rarely. */
  pop: { duration: 420, dampingRatio: 0.55 },
} as const;

/** Gap between items in a staggered entrance. */
export const STAGGER_MS = 40;
/** Only the first screenful staggers (6 cards on a phone); anything later appears with its list. */
export const STAGGER_MAX = 6;
