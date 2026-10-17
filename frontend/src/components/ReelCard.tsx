import { Link } from "expo-router";
import { memo, type ReactNode } from "react";
import { Text, View } from "react-native";

import type { Save } from "../api/contract";
import { relativeShort } from "../lib/dates";
import { displayLink } from "../lib/instagram";
import { CATEGORY } from "../theme/categories";
import { colors } from "../theme/tokens";
import { CategoryDot } from "./CategoryDot";
import { Icon } from "./Icon";
import { PressableScale } from "./motion/PressableScale";
import { Skeleton } from "./Skeleton";
import { Thumb } from "./Thumb";

const firstLine = (text: string | null) => text?.split("\n")[0]?.trim() || null;

/** Card media shape. Square keeps the grid dense on a phone (three rows per screen). */
export const CARD_ASPECT = 1;

/** The title a card shows: real title → caption's first line → the link. */
export function cardTitle(save: Save): string {
  if (save.status === "pending") return displayLink(save.source_url);
  return save.title ?? firstLine(save.caption) ?? displayLink(save.source_url);
}

/**
 * Opens `href` from a card. On iOS 18+ the card's media zooms into the detail screen's hero
 * (the native zoom transition); elsewhere it is a normal push.
 */
export function ZoomLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} push asChild>
      {children}
    </Link>
  );
}

/** One card, three states (pending / enriched / partial), as in "02 Library — light". */
export const ReelCard = memo(function ReelCard({
  save,
  now,
  href,
  onPress,
}: {
  save: Save;
  now: number;
  /** Where the card opens; navigating through a Link lets the media zoom into the detail. */
  href?: string;
  onPress?: () => void;
}) {
  const pending = save.status === "pending";
  const partial = save.status === "partial";
  const category = pending ? null : save.category;
  const meta = category ? `${category} · ${relativeShort(save.created_at, now)}` : relativeShort(save.created_at, now);

  const media = (
    <Thumb uri={pending || partial ? null : save.thumbnail_url} aspect={CARD_ASPECT} radius={12} className="border border-hairline">
      {pending ? (
        <View className="absolute inset-0">
          <Skeleton style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View className="flex-1 items-center justify-center px-3">
            <Icon name="movie" size={28} color={colors.ink3} />
            <Text className="mt-2 text-center font-sans-medium text-meta text-ink-2">Getting details…</Text>
          </View>
        </View>
      ) : null}
      {partial || (!pending && !save.thumbnail_url) ? (
        <View className="absolute inset-0 items-center justify-center bg-raised px-3">
          <Icon name="image-not-supported" size={28} color={colors.ink3} />
          {partial ? (
            <Text className="mt-2 text-center font-sans-medium text-meta text-ink-2">Preview unavailable</Text>
          ) : null}
        </View>
      ) : null}
      {category ? (
        <View
          className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(255,254,251,0.9)" }}
        >
          <Icon name={CATEGORY[category].icon} size={16} color={colors.ink} />
        </View>
      ) : null}
    </Thumb>
  );

  const card = (
    <PressableScale accessibilityRole="button" onPress={onPress} containerClassName="w-full">
      {href ? <Link.AppleZoom>{media}</Link.AppleZoom> : media}
      <View className="mt-2 px-0.5">
        <Text numberOfLines={2} className={`font-sans-semibold text-title ${pending ? "text-ink-2" : "text-ink"}`}>
          {cardTitle(save)}
        </Text>
        {save.note ? (
          <Text numberOfLines={1} className="mt-1 font-sans-italic text-caption text-ink-2">
            {`“${save.note}”`}
          </Text>
        ) : null}
        <View className="mt-1.5 flex-row items-center">
          {category ? (
            <View className="mr-1.5">
              <CategoryDot category={category} />
            </View>
          ) : null}
          <Text numberOfLines={1} className="flex-1 font-sans text-meta text-ink-2">
            {meta}
          </Text>
        </View>
      </View>
    </PressableScale>
  );

  return href ? <ZoomLink href={href}>{card}</ZoomLink> : card;
});
