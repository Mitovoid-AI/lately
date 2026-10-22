import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../theme/ThemeProvider";
import { Button } from "../Button";
import { Icon, type IconName } from "../Icon";
import { PressableScale } from "../motion/PressableScale";

/** What the bar's big button does for this card: Directions for a place, else the source reel. */
export interface PrimaryAction {
  label: string;
  icon: IconName;
  onPress: () => void;
}

function SquareButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.94}
      highlightColor={colors.raised}
      className="h-12 w-12 items-center justify-center rounded-ctl border border-hairline bg-card"
    >
      {children}
    </PressableScale>
  );
}

/**
 * The card's sticky bottom bar: one primary action (it changes with the card) and two icon
 * buttons, Add to stack and Share. It is a sibling under the scroll view, not an overlay, so
 * the content above it never slides beneath it; it pads for the home indicator itself.
 */
export function ActionBar({
  primary,
  onAddToStack,
  onShare,
  stackIconStyle,
}: {
  primary: PrimaryAction;
  onAddToStack: () => void;
  onShare: () => void;
  /** An animated style for the stack icon (the pop after a card lands in a stack). */
  stackIconStyle?: ComponentProps<typeof Animated.View>["style"];
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View className="border-t border-hairline bg-canvas" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
      <View className="w-full max-w-[560px] flex-row items-center gap-2 self-center px-4 pt-3">
        <Button title={primary.label} icon={primary.icon} onPress={primary.onPress} className="flex-1" />
        <SquareButton label="Add to stack" onPress={onAddToStack}>
          <Animated.View style={stackIconStyle}>
            <Icon name="bookmark-border" size={22} color={colors.ink} />
          </Animated.View>
        </SquareButton>
        <SquareButton label="Share" onPress={onShare}>
          <Icon name="share" size={22} color={colors.ink} />
        </SquareButton>
      </View>
    </View>
  );
}
