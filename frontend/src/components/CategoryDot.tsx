import { View } from "react-native";

import type { Category } from "../api/contract";
import { CATEGORY } from "../theme/categories";

export function CategoryDot({ category, size = 6 }: { category: Category; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: CATEGORY[category].color }}
    />
  );
}
