import type { Category } from "../api/contract";
import type { IconName } from "../components/Icon";

/** Category dot colours (light theme) and the icon badge shown on thumbnails. */
export const CATEGORY: Record<Category, { color: string; icon: IconName }> = {
  "Dev & Tools": { color: "#4A6FA5", icon: "code" },
  "Food & Places": { color: "#D35400", icon: "restaurant" },
  "Career & Jobs": { color: "#7E57C2", icon: "work" },
  Fitness: { color: "#2E856E", icon: "hiking" },
  "Style & Vibes": { color: "#C24177", icon: "checkroom" },
  "Watch Later": { color: "#6B655D", icon: "schedule" },
};

export const CATEGORY_ORDER = Object.keys(CATEGORY) as Category[];
