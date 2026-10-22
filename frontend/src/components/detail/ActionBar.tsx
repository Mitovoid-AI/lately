import type { ComponentProps, ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
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

/** From this system text size up, the main button gets a row of its own (its label would wrap beside two squares). */
const STACK_FROM_FONT_SCALE = 1.15;

function SquareButton({
  label,
  onPress,
  fill = false,
  children,
}: {
  label: string;
  onPress: () => void;
  /** Share the row's width with its neighbour instead of being 48 wide. */
  fill?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.94}
      highlightColor={colors.raised}
      containerClassName={fill ? "flex-1" : undefined}
      className={`h-12 ${fill ? "" : "w-12"} items-center justify-center rounded-ctl border border-hairline bg-card`}
    >
      {children}
    </PressableScale>
  );
}

/**
 * The card's sticky bottom bar: one primary action (it changes with the card) and two icon
 * buttons, Add to stack and Share. It is a sibling under the scroll view, not an overlay, so
 * the content above it never slides beneath it; it pads for the home indicator itself. With a
 * big system text size the primary action takes a full-width row above the two icon buttons.
 * Add to stack uses the albums glyph, the Stacks tab's own: a bookmark would read as "unsave".
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
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_FROM_FONT_SCALE;
  const squares = (
    <>
      <SquareButton label="Add to stack" onPress={onAddToStack} fill={stacked}>
        <Animated.View style={stackIconStyle}>
          <Icon name="folder-special" size={22} color={colors.ink} />
        </Animated.View>
      </SquareButton>
      <SquareButton label="Share" onPress={onShare} fill={stacked}>
        <Icon name="share" size={22} color={colors.ink} />
      </SquareButton>
    </>
  );
  return (
    <View className="border-t border-hairline bg-canvas" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
      {stacked ? (
        <View className="w-full max-w-[560px] gap-2 self-center px-4 pt-3">
          <Button title={primary.label} icon={primary.icon} onPress={primary.onPress} />
          <View className="flex-row gap-2">{squares}</View>
        </View>
      ) : (
        <View className="w-full max-w-[560px] flex-row items-center gap-2 self-center px-4 pt-3">
          <Button title={primary.label} icon={primary.icon} onPress={primary.onPress} className="flex-1" />
          {squares}
        </View>
      )}
    </View>
  );
}
