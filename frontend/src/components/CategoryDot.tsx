import { View } from "react-native";

import type { Category } from "../api/contract";
import { categoryColor } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";

export function CategoryDot({ category, size = 6 }: { category: Category; size?: number }) {
  const { scheme } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: categoryColor(category, scheme) }}
    />
  );
}
