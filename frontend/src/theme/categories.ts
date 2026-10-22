import type { Category } from "../api/contract";
import type { IconName } from "../components/Icon";
import type { Scheme } from "./ThemeProvider";

/**
 * Category wayfinding: the dot colour, its icon, and a one-word label for tight spots (a tile's
 * pill). Dots are graphics, so they need 3:1 on white and on raised: light ones measure 3.4 to
 * 5.2:1 on white and 3.1 to 4.6:1 on raised (Food is the lowest). `dark` is the same hue lifted
 * for espresso surfaces (5.0:1+ on canvas, card and raised).
 */
export const CATEGORY: Record<Category, { color: string; dark: string; icon: IconName; short: string }> = {
  "Dev & Tools": { color: "#2F6BDB", dark: "#6E9CF0", icon: "code", short: "Dev" },
  "Food & Places": { color: "#E36529", dark: "#EC7B3F", icon: "restaurant", short: "Food" },
  "Career & Jobs": { color: "#7A55D6", dark: "#A98BEB", icon: "work", short: "Career" },
  Fitness: { color: "#1E9A62", dark: "#45C48B", icon: "hiking", short: "Fitness" },
  "Style & Vibes": { color: "#CF3F7A", dark: "#EA6A9E", icon: "checkroom", short: "Style" },
  "Watch Later": { color: "#726C64", dark: "#A0968A", icon: "schedule", short: "Watch" },
};

export function categoryColor(category: Category, scheme: Scheme): string {
  return scheme === "dark" ? CATEGORY[category].dark : CATEGORY[category].color;
}

/**
 * A category as a small tinted label (tile pill, search results, card detail): a pale tint with
 * the category's deep ink on light, a dark tint with the lifted ink on espresso. Ink on tint,
 * measured: light 6.7:1 (Food, the lowest) to 8.0:1, dark 7.3:1 (Food) to 8.7:1.
 */
export const CATEGORY_PILL: Record<Category, Record<Scheme, { bg: string; ink: string }>> = {
  "Dev & Tools": { light: { bg: "#DDE7FF", ink: "#1A3F8F" }, dark: { bg: "#1B2740", ink: "#9CC2FF" } },
  "Food & Places": { light: { bg: "#FFE2D2", ink: "#8A3208" }, dark: { bg: "#3A2418", ink: "#F5A574" } },
  "Career & Jobs": { light: { bg: "#ECE3FF", ink: "#4B2C9A" }, dark: { bg: "#2A2140", ink: "#CDBBFF" } },
  Fitness: { light: { bg: "#D4F2E3", ink: "#0E5C38" }, dark: { bg: "#16302A", ink: "#7FD3AC" } },
  "Style & Vibes": { light: { bg: "#FCE1EC", ink: "#8A1E4E" }, dark: { bg: "#3A1C2A", ink: "#F2A0C2" } },
  "Watch Later": { light: { bg: "#EEEBE6", ink: "#4A453E" }, dark: { bg: "#2C2722", ink: "#C9BFB2" } },
};

export function categoryPill(category: Category, scheme: Scheme): { bg: string; ink: string } {
  return CATEGORY_PILL[category][scheme];
}

export { CATEGORIES as CATEGORY_ORDER } from "../api/contract";
