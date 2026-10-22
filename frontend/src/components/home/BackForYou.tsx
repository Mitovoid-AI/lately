import { useQuery } from "@tanstack/react-query";
import { Platform, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";

import type { CuratedFeed } from "../../api/contract";
import { useApi } from "../../api/index";
import { scrims } from "../../theme/tokens";
import { PressableScale } from "../motion/PressableScale";
import { Reveal } from "../motion/Reveal";
import { Skeleton, SkeletonGroup } from "../Skeleton";
import { Thumb } from "../Thumb";

/** A memory tile is a small 3:4 poster: a row of them shows the next one peeking in. */
const TILE_W = 132;
const TILE_ASPECT = 3 / 4;
const GAP = 12;
/** Most tiles in the row, and the fewest that make it worth showing at all. */
const MAX_TILES = 6;
const MIN_TILES = 3;
/**
 * Sections of the curated feed that only repeat the grid below (everything, newest first, or
 * a to-do list), so they are not memories.
 */
const NOT_MEMORIES = new Set(["Recently saved", "No note yet"]);

export interface Memory {
  key: string;
  uri: string;
  title: string;
  kicker: string;
  href: string;
}

/** "THIS WEEKEND" → "This weekend": the feed's labels are shouted, a tile's should not be. */
const sentence = (label: string) => (label ? label.charAt(0) + label.slice(1).toLowerCase() : label);

/**
 * The tiles for Back for you: the hero pick first, then saves from the feed's sections, with
 * pictures only (media leads), each save once, at most six. Fewer than three is no row.
 */
export function memoriesFrom(feed: CuratedFeed | undefined): Memory[] {
  if (!feed) return [];
  const out: Memory[] = [];
  const seen = new Set<string>();
  const { hero } = feed;
  if (hero.image_url && hero.save_ids.length > 0) {
    hero.save_ids.forEach((id) => seen.add(id));
    out.push({
      key: "hero",
      uri: hero.image_url,
      title: hero.title,
      kicker: sentence(hero.label),
      // One save opens its card; a group opens the search that lists it.
      href:
        hero.save_ids.length === 1
          ? `/reel/${hero.save_ids[0]}`
          : hero.query
            ? `/search?q=${encodeURIComponent(hero.query)}`
            : "/curated",
    });
  }
  for (const section of feed.sections) {
    if (NOT_MEMORIES.has(section.title)) continue;
    for (const save of section.saves) {
      if (out.length >= MAX_TILES) break;
      if (seen.has(save.id) || save.status !== "enriched" || !save.thumbnail_url) continue;
      seen.add(save.id);
      out.push({
        key: save.id,
        uri: save.thumbnail_url,
        title: save.title ?? "Saved reel",
        kicker: section.title,
        href: `/reel/${save.id}`,
      });
    }
  }
  return out.length >= MIN_TILES ? out.slice(0, MAX_TILES) : [];
}

/** The darkening under a tile's text (the same functional scrim as a Home card). */
const SCRIM: ViewStyle = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  pointerEvents: "none",
  ...(Platform.OS === "web" ? { backgroundImage: scrims.tile.light } : { experimental_backgroundImage: scrims.tile.light }),
} as ViewStyle;

function Tile({ memory, onOpen }: { memory: Memory; onOpen: (href: string) => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${memory.title}, ${memory.kicker}`}
      onPress={() => onOpen(memory.href)}
      containerStyle={{ width: TILE_W }}
    >
      <Thumb uri={memory.uri} aspect={TILE_ASPECT} radius={12}>
        <View style={SCRIM} />
        <View style={styles.text}>
          <Text numberOfLines={1} className="font-sans text-caption text-on-media-muted" style={styles.kicker}>
            {memory.kicker}
          </Text>
          <Text numberOfLines={3} className="font-display text-on-media" style={styles.title}>
            {memory.title}
          </Text>
        </View>
      </Thumb>
    </PressableScale>
  );
}

/**
 * While the feed loads: a bar where the title will be and three tile shapes, so the grid below
 * does not jump when the row arrives. (If the feed turns out empty the block then goes away.)
 */
function LoadingRow() {
  return (
    <SkeletonGroup style={{ marginTop: 24 }}>
      <View className="h-11 justify-center px-4">
        <Skeleton style={{ height: 16, width: 110, borderRadius: 8 }} />
      </View>
      <View style={[styles.row, { marginTop: 4 }]}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ width: TILE_W, aspectRatio: TILE_ASPECT, borderRadius: 12 }} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

/**
 * "Back for you": a row of saves the curated feed wants to bring back, as picture tiles with the
 * reason on them. It never shows an error or an empty box: when the feed fails, is empty or has
 * too little to say, the whole block is simply not there. See all opens the Curated screen.
 */
export function BackForYou({ onOpen, onSeeAll }: { onOpen: (href: string) => void; onSeeAll: () => void }) {
  const api = useApi();
  // The same key as the Curated screen, so the two share one request.
  const feed = useQuery({ queryKey: ["curated"], queryFn: () => api.getCurated() });
  if (feed.isError && !feed.data) return null;
  if (feed.isLoading) return <LoadingRow />;
  const tiles = memoriesFrom(feed.data);
  if (tiles.length === 0) return null;
  return (
    <Reveal style={{ marginTop: 24 }}>
      <View className="flex-row items-center justify-between pl-4 pr-2">
        <Text className="font-display text-display-sm text-ink">Back for you</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="See all picks"
          onPress={onSeeAll}
          scaleTo={0.96}
          className="h-11 justify-center px-2"
        >
          <Text className="font-sans-semibold text-body text-accent-text">See all</Text>
        </PressableScale>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={TILE_W + GAP}
        snapToAlignment="start"
        className="mt-1"
        contentContainerStyle={styles.row}
      >
        {tiles.map((m) => (
          <Tile key={m.key} memory={m} onOpen={onOpen} />
        ))}
      </ScrollView>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: GAP, paddingHorizontal: 16 },
  text: { position: "absolute", left: 10, right: 10, bottom: 10 },
  kicker: { marginBottom: 2 },
  // Android: no font padding, so the title sits on its 18 pt lines over the photo.
  title: { fontSize: 14, lineHeight: 18, letterSpacing: -0.1, includeFontPadding: false },
});
