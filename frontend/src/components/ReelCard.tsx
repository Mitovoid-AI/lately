import { Link } from "expo-router";
import { memo, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, type ViewStyle } from "react-native";

import type { Save } from "../api/contract";
import { relativeShort } from "../lib/dates";
import { displayLink } from "../lib/instagram";
import { stageLabel } from "../lib/saveOutcome";
import { CATEGORY } from "../theme/categories";
import { useTheme, type Scheme } from "../theme/ThemeProvider";
import { scrims } from "../theme/tokens";
import { CategoryPill } from "./Chip";
import { Icon } from "./Icon";
import { PressableScale } from "./motion/PressableScale";
import { Skeleton } from "./Skeleton";
import { Thumb } from "./Thumb";

const firstLine = (text: string | null) => text?.split("\n")[0]?.trim() || null;

/**
 * Card media shape (width / height). Tall tiles match vertical reels. The title sits on the
 * image, so a row stays about as tall as the old square tile plus its text block
 * (164 pt square + ~62 pt of text ≈ 226 pt, vs 164 × 4/3 ≈ 219 pt).
 */
export const CARD_ASPECT = 3 / 4;

/** What a card is called until Lately has read the reel (the link, small, is shown as meta). */
export const PENDING_TITLE = "New reel";

/** The title a card shows: "New reel" while pending → real title → caption's first line → the link. */
export function cardTitle(save: Save): string {
  if (save.status === "pending") return PENDING_TITLE;
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

/** The bottom scrim over a tile's photo; the same gradient in both themes. */
function scrimFor(gradient: string) {
  return {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: "none",
    ...(Platform.OS === "web" ? { backgroundImage: gradient } : { experimental_backgroundImage: gradient }),
  } as ViewStyle;
}
const SCRIM: Record<Scheme, ViewStyle> = { light: scrimFor(scrims.tile.light), dark: scrimFor(scrims.tile.dark) };

/**
 * The tile is a fixed 3:4 box with its text pinned to the bottom, so the text cannot grow
 * freely with the system text size: past this it climbs out of the scrim and into the
 * placeholder and pill. The full title is still in the label and on the detail screen.
 */
const MAX_FONT_SCALE = 1.3;

/**
 * One card, three states (pending / enriched / partial). The category is a tinted pill with a
 * one-word label ("Food") top right rather than the old icon badge: the colour is the wayfinding
 * and the word makes the colour readable. The longest label ("Fitness", about 60 pt wide) fits a
 * 165 pt tile at 375 wide with room to spare, even at 1.3x text (about 72 pt). Because the pill
 * names the category, the line at the bottom is only the date; the screen-reader label still
 * reads both.
 */
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
  const { colors, shadows, scheme } = useTheme();
  const pending = save.status === "pending";
  const partial = save.status === "partial";
  const category = pending ? null : save.category;
  const when = relativeShort(save.created_at, now);
  const meta = category ? `${category} · ${when}` : when;
  const uri = pending || partial ? null : save.thumbnail_url;
  // White text over a scrim when the photo shows; theme colours over the placeholder fills.
  const onImage = !!uri;
  const title = cardTitle(save);
  const note = save.note ? `“${save.note}”` : null;
  // A pending tile says which step the server is on, in the tracker's words ("Getting details" until it says).
  const status = pending ? stageLabel(save.stage) : partial ? "Preview unavailable" : null;
  // One screen-reader stop: title, note, meta, then the loading state if there is one.
  const label = [title, save.note, meta, status].filter(Boolean).join(", ");

  const media = (
    <Thumb uri={uri} aspect={CARD_ASPECT} radius={12}>
      {pending ? (
        <View className="absolute inset-0">
          <Skeleton style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View style={styles.upper} className="items-center justify-center px-3">
            <Icon name="movie" size={28} color={colors.ink3} />
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              className="mt-2 text-center font-sans-medium text-meta text-ink-2"
            >
              {status}
            </Text>
          </View>
        </View>
      ) : null}
      {!pending && !uri ? (
        <View className="absolute inset-0 bg-raised">
          <View style={styles.upper} className="items-center justify-center px-3">
            <Icon name="image-not-supported" size={28} color={colors.ink3} />
            {partial ? (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                className="mt-2 text-center font-sans-medium text-meta text-ink-2"
              >
                Preview unavailable
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {onImage ? <View style={SCRIM[scheme]} /> : null}
      <View style={styles.text}>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          className={`font-display ${onImage ? "text-on-media" : pending ? "text-ink-2" : "text-ink"}`}
          style={styles.title}
        >
          {title}
        </Text>
        {note ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            className={`font-sans-italic text-caption ${onImage ? "text-on-media-muted" : "text-ink-2"}`}
            style={styles.note}
          >
            {note}
          </Text>
        ) : null}
        <View className="flex-row items-center" style={styles.meta}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            className={`flex-1 font-sans text-caption ${onImage ? "text-on-media-muted" : "text-ink-2"}`}
          >
            {when}
          </Text>
        </View>
      </View>
      {category ? (
        <View className="absolute right-2 top-2 rounded-full" style={{ boxShadow: shadows.raised }}>
          <CategoryPill
            category={category}
            label={CATEGORY[category].short}
            size="sm"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            onPhoto={onImage}
          />
        </View>
      ) : null}
    </Thumb>
  );

  const card = (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} containerClassName="w-full">
      {href ? <Link.AppleZoom>{media}</Link.AppleZoom> : media}
    </PressableScale>
  );

  return href ? <ZoomLink href={href}>{card}</ZoomLink> : card;
});

const styles = StyleSheet.create({
  /** The placeholder icon and label sit in the upper part, clear of the text block. */
  upper: { position: "absolute", top: 0, left: 0, right: 0, bottom: "42%" },
  text: { position: "absolute", left: 10, right: 10, bottom: 10 },
  // Android: no font padding, so the title sits exactly on its 18 pt lines over the photo.
  title: { fontSize: 14, lineHeight: 18, letterSpacing: -0.1, includeFontPadding: false },
  note: { marginTop: 3 },
  meta: { marginTop: 4 },
});
