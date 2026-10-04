import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";

import { colors } from "../theme/tokens";

export type IconName = ComponentProps<typeof MaterialIcons>["name"];

/** Stitch uses Material Symbols; these are the matching Material icons. */
export function Icon({ name, size = 22, color = colors.ink2 }: { name: IconName; size?: number; color?: string }) {
  return <MaterialIcons name={name} size={size} color={color} />;
}
