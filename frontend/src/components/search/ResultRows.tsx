import { memo } from "react";
import { Text, View } from "react-native";

import type { SearchHit } from "../../api/contract";
import { relativeShort } from "../../lib/dates";
import { whyChips, type WhyChip } from "../../lib/search";
import { useTheme } from "../../theme/ThemeProvider";
import { CategoryPill } from "../Chip";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";
import { cardTitle } from "../ReelCard";
import { Thumb } from "../Thumb";

/** "@creator · 3d": who made it and how long ago it was saved. */
function metaLine(hit: SearchHit, now: number): string {
  const s = hit.save;
  const who = s.creator ? `@${s.creator}` : null;
  return [who, relativeShort(s.created_at, now)].filter(Boolean).join(" · ");
}

/** The image a result shows: the photo once the card is ready, otherwise nothing yet. */
function thumbUri(hit: SearchHit): string | null {
  return hit.save.status === "enriched" ? hit.save.thumbnail_url : null;
}

/** Why a result matched, as short chips (a place chip carries a pin icon, never an emoji). */
export function WhyChips({ chips, className = "" }: { chips: WhyChip[]; className?: string }) {
  const { colors } = useTheme();
  if (chips.length === 0) return null;
  return (
    <View className={`flex-row flex-wrap gap-1.5 ${className}`}>
      {chips.map((chip, i) => (
        <View key={chip.text} className="min-h-7 max-w-full flex-row items-center rounded-full bg-raised px-2.5 py-1">
          {chip.kind === "place" ? (
            <View className="mr-1">
              <Icon name="place" size={13} color={colors.ink2} />
            </View>
          ) : null}
          <Text numberOfLines={1} className={`shrink font-sans-medium text-caption ${i === 0 ? "text-ink" : "text-ink-2"}`}>
            {chip.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function NoImage({ size }: { size: number }) {
  const { colors } = useTheme();
  return (
    <View className="absolute inset-0 items-center justify-center">
      <Icon name="movie" size={size} color={colors.ink3} />
    </View>
  );
}

/**
 * The answer: the best match as one large card (16:10 photo, title in display type, who and
 * when, its category, and up to three reasons it matched). Memoised like the rows below it.
 */
export const BestMatch = memo(function BestMatch({
  hit,
  now,
  onOpen,
}: {
  hit: SearchHit;
  now: number;
  onOpen: (hit: SearchHit) => void;
}) {
  const s = hit.save;
  const uri = thumbUri(hit);
  const chips = whyChips(hit.why, 3);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[
        cardTitle(s),
        s.creator ? `@${s.creator}` : null,
        s.category,
        chips.length ? `Matched: ${chips.map((c) => c.text).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={() => onOpen(hit)}
      scaleTo={0.98}
      containerClassName="w-full"
    >
      <View className="overflow-hidden rounded-2xl border border-hairline bg-card">
        <Thumb uri={uri} aspect={16 / 10} radius={0}>
          {uri ? null : <NoImage size={36} />}
        </Thumb>
        <View className="px-4 pb-4 pt-3">
          <Text numberOfLines={3} className="font-display text-display-md text-ink">
            {cardTitle(s)}
          </Text>
          <View className="mt-2 flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
            {s.category ? <CategoryPill category={s.category} /> : null}
            <Text numberOfLines={1} className="shrink font-sans text-meta text-ink-2">
              {metaLine(hit, now)}
            </Text>
          </View>
          <WhyChips chips={chips} className="mt-3" />
        </View>
      </View>
    </PressableScale>
  );
});

/** A further result: small thumbnail, title, category and creator, the strongest reason. */
export const CompactRow = memo(function CompactRow({
  hit,
  now,
  onOpen,
}: {
  hit: SearchHit;
  now: number;
  onOpen: (hit: SearchHit) => void;
}) {
  const { colors } = useTheme();
  const s = hit.save;
  const uri = thumbUri(hit);
  const chips = whyChips(hit.why, 1);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[cardTitle(s), s.creator ? `@${s.creator}` : null, s.category].filter(Boolean).join(", ")}
      onPress={() => onOpen(hit)}
      scaleTo={1}
      highlightColor={colors.raised}
      className="-mx-2 min-h-[88px] flex-row rounded-xl px-2 py-3"
    >
      <View style={{ width: 56 }}>
        <Thumb uri={uri} aspect={56 / 72} radius={12}>
          {uri ? null : <NoImage size={20} />}
        </Thumb>
      </View>
      <View className="ml-3 flex-1">
        <Text numberOfLines={2} className="font-sans-semibold text-title text-ink">
          {cardTitle(s)}
        </Text>
        <View className="mt-1.5 flex-row flex-wrap items-center gap-x-2 gap-y-1">
          {s.category ? <CategoryPill category={s.category} /> : null}
          <Text numberOfLines={1} className="shrink font-sans text-caption text-ink-2">
            {metaLine(hit, now)}
          </Text>
        </View>
        <WhyChips chips={chips} className="mt-1.5" />
      </View>
    </PressableScale>
  );
});
