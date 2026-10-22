import { Image } from "expo-image";
import { Text, View } from "react-native";

import { categoryPill } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";
import { Icon } from "./Icon";

// Local pictures from the design set: no network, so the first screen never waits on an image.
const REEL_IMAGE = require("../../assets/stitch/lib-momos.jpg");
const CARD_IMAGE = require("../../assets/stitch/detail-momos.jpg");

/** The sample picture is an illustration: it keeps its size when the phone's text is enlarged. */
const SAMPLE_FONT_CAP = 1.2;

/** A fact chip on the sample card (static: it is a picture of a card, not a control). */
function Fact({ icon, label }: { icon?: "place"; label: string }) {
  const { colors } = useTheme();
  return (
    <View className="min-h-6 flex-row items-center rounded-full bg-raised px-2 py-0.5">
      {icon ? (
        <View className="mr-1">
          <Icon name={icon} size={12} color={colors.ink2} />
        </View>
      ) : null}
      <Text numberOfLines={1} maxFontSizeMultiplier={SAMPLE_FONT_CAP} className="shrink font-sans-medium text-caption text-ink">
        {label}
      </Text>
    </View>
  );
}

/**
 * The whole idea in one picture, instead of instructions: a reel on the left, the card Lately
 * makes from it on the right. It is a made-up sample (the "Example" tag says so), built from
 * local images, never from the person's data. The card flexes, so the pair fits a 320 pt phone.
 * Used on Home's first run and on the sign-in screen.
 */
export function ExamplePair({ centered = false }: { centered?: boolean }) {
  const { colors, scheme, shadows } = useTheme();
  const pill = categoryPill("Food & Places", scheme);
  return (
    <View
      accessible
      accessibilityLabel="Example. A saved reel on the left turns into a card with a title, two key facts and a category."
    >
      <View
        className={`min-h-6 flex-row items-center rounded-full border border-hairline px-2.5 ${centered ? "self-center" : "self-start"}`}
      >
        <Text maxFontSizeMultiplier={SAMPLE_FONT_CAP} className="font-sans-semibold text-caption text-ink-2">
          Example
        </Text>
      </View>
      <View className="mt-3 flex-row items-center justify-center" style={{ gap: 4 }}>
        {/* Before: a vertical reel with Instagram's mark and a play glyph. */}
        <View className="overflow-hidden rounded-2xl bg-raised" style={{ width: 96, aspectRatio: 9 / 16 }}>
          <Image source={REEL_IMAGE} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          <View className="absolute inset-0 items-center justify-center">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-scrim">
              <Icon name="play-arrow" size={20} color={colors.onMedia} />
            </View>
          </View>
        </View>
        <Icon name="chevron-right" size={22} color={colors.ink3} />
        {/* After: the card, with its title, two facts and category. */}
        <View
          className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-hairline bg-card"
          style={{ maxWidth: 172, boxShadow: shadows.card }}
        >
          <Image source={CARD_IMAGE} contentFit="cover" style={{ width: "100%", height: 92 }} />
          <View className="p-3">
            <View className="min-h-6 flex-row items-center self-start rounded-full px-2 py-0.5" style={{ backgroundColor: pill.bg }}>
              <Text maxFontSizeMultiplier={SAMPLE_FONT_CAP} className="font-sans-semibold text-caption" style={{ color: pill.ink }}>
                Food & Places
              </Text>
            </View>
            <Text maxFontSizeMultiplier={SAMPLE_FONT_CAP} className="mt-2 font-display text-body text-ink">
              Steamed dumplings with chili crisp
            </Text>
            <View className="mt-2 flex-row flex-wrap" style={{ gap: 6 }}>
              <Fact icon="place" label="Chinatown, NYC" />
              <Fact label="$14 a basket" />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
