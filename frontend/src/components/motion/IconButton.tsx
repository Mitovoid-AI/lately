import type { ReactNode } from "react";

import type { HapticKind } from "../../lib/haptics";
import { colors } from "../../theme/tokens";
import { Icon, type IconName } from "../Icon";
import { PressableScale } from "./PressableScale";

/** A 48×48 round icon target: a raised tint fades in behind the icon and it dips to 0.9. */
export function IconButton({
  icon,
  label,
  onPress,
  color = colors.ink2,
  size = 22,
  haptic,
  className,
  children,
}: {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  color?: string;
  size?: number;
  haptic?: HapticKind;
  /** Layout classes for the target (margins). */
  className?: string;
  /** Custom content (an avatar, an AnimatedIcon) instead of `icon`. */
  children?: ReactNode;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic={haptic}
      scaleTo={0.9}
      highlightColor={colors.raised}
      hitSlop={4}
      containerClassName={className}
      className="h-12 w-12 items-center justify-center rounded-full"
    >
      {children ?? (icon ? <Icon name={icon} size={size} color={color} /> : null)}
    </PressableScale>
  );
}
