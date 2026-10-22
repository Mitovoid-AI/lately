import { Image } from "expo-image";
import { Text, View } from "react-native";

import { categoryPill } from "../../theme/categories";
import { useTheme } from "../../theme/ThemeProvider";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Reveal } from "../motion/Reveal";
import { openInstagram } from "./openInstagram";

// Local pictures from the design set: no network, so the first screen never waits on an image.
const REEL_IMAGE = require("../../../assets/stitch/lib-momos.jpg");
const CARD_IMAGE = require("../../../assets/stitch/detail-momos.jpg");

/** A fact chip on the sample card (static: it is a picture of a card, not a control). */
function Fact({ icon, label }: { icon?: "place"; label: string }) {
  const { colors } = useTheme();
  return (
    <View className="h-6 flex-row items-center rounded-full bg-raised px-2">
      {icon ? (
        <View className="mr-1">
          <Icon name={icon} size={12} color={colors.ink2} />
        </View>
      ) : null}
      <Text numberOfLines={1} className="font-sans-medium text-caption text-ink">
        {label}
      </Text>
    </View>
  );
}

/**
 * The whole idea in one picture, instead of instructions: a reel on the left, the card Lately
 * makes from it on the right. It is a made-up sample (the "Example" tag says so), built from
 * local images, never from the person's data.
 */
function BeforeAfter() {
  const { colors, scheme, shadows } = useTheme();
  const pill = categoryPill("Food & Places", scheme);
  return (
    <View
      accessible
      accessibilityLabel="Example. A saved reel on the left turns into a card with a title, two key facts and a category."
    >
      <View className="h-6 flex-row items-center self-start rounded-full border border-hairline px-2.5">
        <Text className="font-sans-semibold text-caption text-ink-2">Example</Text>
      </View>
      <View className="mt-3 flex-row items-center justify-center" style={{ gap: 4 }}>
        {/* Before: a vertical reel with Instagram's mark and a play glyph. */}
        <View className="overflow-hidden rounded-2xl bg-raised" style={{ width: 104, aspectRatio: 9 / 16 }}>
          <Image source={REEL_IMAGE} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          <View className="absolute left-2 top-2 h-7 w-7 items-center justify-center rounded-full bg-scrim">
            <Icon name="instagram" size={15} color={colors.onMedia} />
          </View>
          <View className="absolute inset-0 items-center justify-center">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-scrim">
              <Icon name="play-arrow" size={20} color={colors.onMedia} />
            </View>
          </View>
        </View>
        <Icon name="chevron-right" size={22} color={colors.ink3} />
        {/* After: the card, with its title, two facts and category. */}
        <View
          className="overflow-hidden rounded-2xl border border-hairline bg-card"
          style={{ width: 172, boxShadow: shadows.card }}
        >
          <Image source={CARD_IMAGE} contentFit="cover" style={{ width: "100%", height: 92 }} />
          <View className="p-3">
            <View className="h-6 flex-row items-center self-start rounded-full px-2" style={{ backgroundColor: pill.bg }}>
              <Text className="font-sans-semibold text-caption" style={{ color: pill.ink }}>
                Food & Places
              </Text>
            </View>
            <Text className="mt-2 font-display text-body text-ink">Steamed dumplings with chili crisp</Text>
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

/**
 * Home with nothing saved yet: say what Lately does, show it once, then point at the one move
 * that starts it. No numbered steps, no tour.
 */
export function FirstRun({ onPaste, onOpenInstagram = () => void openInstagram() }: { onPaste: () => void; onOpenInstagram?: () => void }) {
  return (
    <View className="w-full max-w-[420px] self-center px-4 pt-6">
      <Reveal index={0}>
        <Text className="font-display-heavy text-display-lg text-ink">Every reel you save, findable in one search.</Text>
      </Reveal>
      <Reveal index={1} style={{ marginTop: 24 }}>
        <BeforeAfter />
      </Reveal>
      <Reveal index={2} style={{ marginTop: 28 }}>
        <Text className="font-sans-medium text-body text-ink">In Instagram, tap Share, then Lately.</Text>
      </Reveal>
      <Reveal index={3} style={{ marginTop: 16, gap: 12 }}>
        <Button title="Open Instagram" icon="instagram" onPress={onOpenInstagram} />
        <Button title="Paste a link instead" variant="secondary" icon="link" onPress={onPaste} />
      </Reveal>
    </View>
  );
}
