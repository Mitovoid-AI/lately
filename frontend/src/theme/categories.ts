import type { Category } from "../api/contract";
import type { IconName } from "../components/Icon";
import type { Scheme } from "./ThemeProvider";

/**
 * Category dot colours and the icon badge shown on thumbnails. `dark` is the same hue lifted
 * for espresso surfaces (5:1+ on card and raised; the light ones fall to 3:1 there).
 */
export const CATEGORY: Record<Category, { color: string; dark: string; icon: IconName }> = {
  "Dev & Tools": { color: "#4A6FA5", dark: "#7A9AD0", icon: "code" },
  "Food & Places": { color: "#D35400", dark: "#E8813A", icon: "restaurant" },
  "Career & Jobs": { color: "#7E57C2", dark: "#A586DB", icon: "work" },
  Fitness: { color: "#2E856E", dark: "#4FB394", icon: "hiking" },
  "Style & Vibes": { color: "#C24177", dark: "#DE6F9E", icon: "checkroom" },
  "Watch Later": { color: "#6B655D", dark: "#A0968A", icon: "schedule" },
};

export function categoryColor(category: Category, scheme: Scheme): string {
  return scheme === "dark" ? CATEGORY[category].dark : CATEGORY[category].color;
}

export { CATEGORIES as CATEGORY_ORDER } from "../api/contract";
