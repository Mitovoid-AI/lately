import { View } from "react-native";

import type { Category } from "../api/contract";
import { CATEGORY, categoryColor } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";

/**
 * A category's colour dot. `onMedia` is for a dot over a photo's dark scrim: it takes the
 * lifted (dark-surface) hue in both themes, since the light ones drop below 3:1 there.
 */
export function CategoryDot({
  category,
  size = 6,
  onMedia = false,
}: {
  category: Category;
  size?: number;
  onMedia?: boolean;
}) {
  const { scheme } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: onMedia ? CATEGORY[category].dark : categoryColor(category, scheme),
      }}
    />
  );
}
