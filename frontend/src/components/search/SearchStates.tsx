import { Text, View } from "react-native";

import { MIN_EXAMPLES } from "../../lib/searchExamples";
import { useTheme } from "../../theme/ThemeProvider";
import { Chip } from "../Chip";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";
import { Reveal } from "../motion/Reveal";
import { Skeleton, SkeletonGroup, SkeletonRow } from "../Skeleton";

/**
 * Example searches as chips: the kind of thing people type to find a reel again. The caller
 * decides where they come from (the demo's list, or the user's own saves in the live app) and
 * fewer than three is no row at all: a lone chip reads as an advert, not a hint.
 */
export function ExampleChips({
  examples,
  onPick,
  title = "Try searching for",
  count,
  start = 0,
}: {
  examples: readonly string[];
  onPick: (query: string) => void;
  title?: string;
  /** How many examples to show (all by default). */
  count?: number;
  /** Stagger index for the entrance. */
  start?: number;
}) {
  if (examples.length < MIN_EXAMPLES) return null;
  const shown = count ? examples.slice(0, count) : examples;
  return (
    <Reveal index={start} style={{ marginTop: 24 }}>
      <Text className="font-sans-semibold text-meta text-ink-2">{title}</Text>
      <View className="mt-3 flex-row flex-wrap gap-x-2 gap-y-3">
        {shown.map((q) => (
          <Chip key={q} label={q} onPress={() => onPick(q)} />
        ))}
      </View>
    </Reveal>
  );
}

/**
 * The empty query: recent searches (when there are any) with a Clear, then example chips.
 * With nothing recent the screen leads with a line about what to type instead.
 */
export function IdleState({
  recent,
  examples,
  onPick,
  onClearRecent,
}: {
  recent: string[];
  examples: readonly string[];
  onPick: (query: string) => void;
  onClearRecent: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View className="w-full max-w-[640px] self-center px-4 pt-5">
      {recent.length ? (
        <View>
          <Reveal index={0}>
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-semibold text-meta text-ink-2">Recent</Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                onPress={onClearRecent}
                scaleTo={0.95}
                containerClassName="-mr-3"
                className="h-11 justify-center px-3"
              >
                <Text className="font-sans-semibold text-meta text-ink">Clear</Text>
              </PressableScale>
            </View>
          </Reveal>
          {recent.map((r, i) => (
            <Reveal key={r} index={i + 1}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Search ${r} again`}
                onPress={() => onPick(r)}
                scaleTo={1}
                highlightColor={colors.raised}
                className="-mx-2 h-12 flex-row items-center rounded-xl px-2"
              >
                <Icon name="history" size={20} color={colors.ink3} />
                <Text numberOfLines={1} className="ml-3 flex-1 font-sans text-body text-ink">
                  {r}
                </Text>
              </PressableScale>
            </Reveal>
          ))}
        </View>
      ) : (
        <Reveal index={0}>
          <Text className="font-display text-display-md text-ink">Find a reel by what you remember</Text>
          <Text className="mt-2 font-sans text-body text-ink-2">
            A place, a dish, a topic, or a word from your own note.
          </Text>
        </Reveal>
      )}
      <ExampleChips examples={examples} onPick={onPick} start={Math.min(recent.length + 1, 6)} />
    </View>
  );
}

/** Nothing matched: say what was searched, how to widen it, and offer a few searches that work. */
export function NoResults({
  query,
  examples,
  onPick,
}: {
  query: string;
  examples: readonly string[];
  onPick: (query: string) => void;
}) {
  return (
    <View className="w-full max-w-[640px] self-center px-4 pt-10">
      <Reveal index={0}>
        {/* A live region: the screen reader says it when the results turn out to be none. */}
        <Text accessibilityLiveRegion="polite" className="font-display text-display-md text-ink">
          {`Nothing matched “${query}”`}
        </Text>
        <Text className="mt-2 font-sans text-body text-ink-2">Try fewer words, or a place, dish or topic.</Text>
      </Reveal>
      <ExampleChips examples={examples} onPick={onPick} count={3} start={1} />
    </View>
  );
}

/** The result layout in grey: a large card for the best match, then two compact rows. */
export function SearchSkeleton() {
  return (
    <SkeletonGroup style={{ width: "100%", maxWidth: 640, alignSelf: "center", paddingHorizontal: 16, paddingTop: 16 }}>
      <Skeleton style={{ height: 14, width: 96, borderRadius: 7 }} />
      <View className="mt-3">
        <Skeleton style={{ aspectRatio: 16 / 10, borderRadius: 16 }} />
        <Skeleton style={{ marginTop: 14, height: 20, width: "80%", borderRadius: 8 }} />
        <Skeleton style={{ marginTop: 8, height: 14, width: "55%", borderRadius: 7 }} />
      </View>
      <Skeleton style={{ marginTop: 24, height: 14, width: 150, borderRadius: 7 }} />
      <View className="mt-1">
        <SkeletonRow />
        <SkeletonRow />
      </View>
    </SkeletonGroup>
  );
}
