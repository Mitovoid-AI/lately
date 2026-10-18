import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import type { Category, Save } from "../api/contract";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Header } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { PopIn, Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { ReelCard } from "../components/ReelCard";
import { SkeletonGrid } from "../components/Skeleton";
import { useNow } from "../hooks/useNow";
import { useMe, useSaves } from "../hooks/useSaves";
import { haptic } from "../lib/haptics";
import { DURATION, EASE_OUT } from "../theme/motion";
import { countOf } from "../lib/counts";
import { CATEGORY_ORDER, categoryColor } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";
import { ErrorState } from "../components/ErrorState";
import { useSaveQueue } from "../hooks/useSaveQueue";

const MAX_WIDTH = 1280;
const GAP = 12;
const SIDE = 16;

function SearchField({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="search"
      onPress={onPress}
      scaleTo={0.985}
      highlightColor={colors.raised}
      className="h-10 flex-row items-center rounded-ctl border border-hairline bg-card px-3"
    >
      <Icon name="search" size={18} color={colors.ink3} />
      <Text numberOfLines={1} className="ml-2 flex-1 font-sans text-body text-ink-3">
        Search what you remember…
      </Text>
    </PressableScale>
  );
}

/** Saves made offline, waiting on the device for a connection. */
function QueuedBanner({ count, busy, onRetry }: { count: number; busy: boolean; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <Reveal>
      <View className="mt-3 flex-row items-center rounded-2xl border border-hairline bg-card py-2 pl-4 pr-2">
        <Icon name="cloud-upload" size={22} color={colors.accent} />
        <View className="ml-3 flex-1">
          <Text className="font-sans-semibold text-body text-ink">
            {`${countOf(count, "reel")} waiting to save`}
          </Text>
          <Text className="font-sans text-meta text-ink-2">
            {`Lately saves ${count === 1 ? "it" : "them"} when you're back online.`}
          </Text>
        </View>
        <Button title="Retry" variant="ghost" onPress={onRetry} loading={busy} />
      </View>
    </Reveal>
  );
}

function EmptyState({ onPaste }: { onPaste: () => void }) {
  const { colors } = useTheme();
  const steps: { icon: IconName; text: string }[] = [
    { icon: "play-circle-outline", text: "Open a reel in Instagram" },
    { icon: "ios-share", text: "Tap Share → Lately" },
    { icon: "edit-note", text: "Add a reason (optional)" },
  ];
  return (
    <View className="items-center px-6 pt-12">
      <Reveal index={0}>
        <Text className="text-center font-display text-display-lg text-ink">Nothing saved yet</Text>
        <Text className="mt-2 text-center font-sans text-body text-ink-2">
          Save a reel from Instagram and it shows up here.
        </Text>
      </Reveal>
      <View className="mt-8 w-full max-w-[340px] gap-3">
        {steps.map((s, i) => (
          <Reveal key={s.text} index={i + 1}>
            <View className="flex-row items-center rounded-2xl border border-hairline bg-card p-4">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-raised">
                <Text className="font-sans-semibold text-body text-accent">{i + 1}</Text>
              </View>
              <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">{s.text}</Text>
              <Icon name={s.icon} size={22} color={colors.ink3} />
            </View>
          </Reveal>
        ))}
      </View>
      <Reveal index={4} style={{ width: "100%", maxWidth: 340 }}>
        <Button title="Paste a link instead" variant="secondary" icon="link" onPress={onPaste} className="mt-8" />
      </Reveal>
    </View>
  );
}

export function LibraryScreen() {
  const { colors, scheme, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();
  // The whole library decides which chips exist; a chip asks the API for its category.
  const all = useSaves();
  const saves = all.saves;
  const me = useMe().data;
  const queue = useSaveQueue();
  const [filter, setFilter] = useState<Category | "All">("All");

  const categories = useMemo(
    () => CATEGORY_ORDER.filter((c) => saves.some((s) => s.status !== "pending" && s.category === c)),
    [saves],
  );
  const active = filter !== "All" && !categories.includes(filter) ? "All" : filter;
  const filtered = useSaves(active === "All" ? undefined : active);
  const list = active === "All" ? all : filtered;
  const { isLoading, fetchNextPage, refetch, isRefetching } = list;
  const shown = list.saves;
  const failed = list.isError;

  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;
  const inner = Math.min(width, MAX_WIDTH) - SIDE * 2;
  const itemWidth = (inner - GAP * (columns - 1)) / columns;
  const empty = !all.isLoading && !all.isError && saves.length === 0;
  const paste = useCallback(() => router.push("/save-sheet"), [router]);

  // Cards stagger in when content arrives and again for each new filter; cards mounted later
  // by scrolling simply appear, so the list never flickers.
  const entrance = useEntranceWindow(active, !isLoading);

  // Scroll drives the header hairline and tucks the paste button away while reading down.
  const scrollY = useSharedValue(0);
  const lastY = useSharedValue(0);
  const fabAway = useSharedValue(0);
  const fabTarget = useSharedValue(0);
  const [fabTouchable, setFabTouchable] = useState(true);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      const dy = y - lastY.get();
      lastY.set(y);
      scrollY.set(y);
      const next = y < 80 ? 0 : dy > 6 ? 1 : dy < -6 ? 0 : fabTarget.get();
      if (next !== fabTarget.get()) {
        fabTarget.set(next);
        fabAway.set(withTiming(next, { duration: DURATION.state + 40, easing: EASE_OUT }));
      }
    },
  });
  useAnimatedReaction(
    () => fabTarget.get(),
    (target, prev) => {
      if (prev !== null && target !== prev) scheduleOnRN(setFabTouchable, target === 0);
    },
  );
  const fabStyle = useAnimatedStyle(() => ({
    opacity: 1 - fabAway.get(),
    transform: [{ translateY: 16 * fabAway.get() }, { scale: 1 - 0.08 * fabAway.get() }],
  }));

  const pick = useCallback((c: Category | "All") => setFilter(c), []);

  const renderItem = useCallback(
    ({ item, index }: { item: Save; index: number }) => (
      <Reveal index={index} enabled={entrance} style={{ width: itemWidth }}>
        <ReelCard save={item} now={now} href={`/reel/${item.id}`} />
      </Reveal>
    ),
    [entrance, itemWidth, now],
  );

  const listHeader = (
    <View className="w-full self-center" style={{ maxWidth: MAX_WIDTH }}>
      <View className="px-4 pt-1">
        <SearchField onPress={() => router.push("/search")} />
        {queue.queued.length > 0 ? (
          <QueuedBanner count={queue.queued.length} busy={queue.flushing} onRetry={() => queue.flush()} />
        ) : null}
      </View>
      {empty ? null : (
        <>
          {categories.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SIDE, gap: 8 }}
              className="mt-3"
            >
              <Chip label="All" active={active === "All"} haptic="selection" onPress={() => pick("All")} />
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  dotColor={categoryColor(c, scheme)}
                  active={active === c}
                  haptic="selection"
                  onPress={() => pick(c)}
                />
              ))}
            </ScrollView>
          ) : null}
          <View className="mt-4 flex-row items-center justify-between px-4">
            <Text className="font-sans-semibold text-label text-ink-2">RECENTLY SAVED</Text>
            {me ? <Text className="font-sans text-meta text-ink-2">{countOf(me.total_saves, "reel")}</Text> : null}
          </View>
        </>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <Header
        avatarUrl={me?.avatar_url}
        initial={me?.name?.[0]}
        onAvatar={() => router.push("/account")}
        onBookmark={() => router.push("/stacks")}
        scrollY={scrollY}
      />
      <Animated.FlatList
        key={`grid-${columns}`}
        data={empty || failed ? [] : shown}
        keyExtractor={(s: Save) => `${active}:${s.id}`}
        numColumns={columns}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: SIDE, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 96, gap: 16 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonGrid columns={columns} itemWidth={itemWidth} />
          ) : failed ? (
            <ErrorState title="Couldn't load your reels" onRetry={() => refetch()} retrying={isRefetching} />
          ) : empty ? (
            <EmptyState onPaste={paste} />
          ) : null
        }
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={9}
        // No removeClippedSubviews: on Android (new architecture) it left the grid blank
        // when the header changed height (the "waiting to save" banner going away) until
        // the list re-rendered. windowSize still virtualizes long libraries.
        onEndReached={fetchNextPage}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              haptic.light();
              refetch();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        }
      />
      {empty ? null : (
        <Animated.View style={[styles.fab, { pointerEvents: fabTouchable ? "auto" : "none" }, fabStyle]}>
          <PopIn delay={240}>
          <PressableScale
            accessibilityRole="button"
            onPress={paste}
            haptic="light"
            scaleTo={0.94}
            highlightColor={colors.accentPressed}
            className="h-12 flex-row items-center rounded-full bg-accent pl-3.5 pr-4"
            containerStyle={[styles.fabShadow, { boxShadow: shadows.accent }]}
          >
            <Icon name="add" size={22} color={colors.onAccent} />
            <Text className="ml-1.5 font-sans-semibold text-meta text-on-accent">Paste link</Text>
          </PressableScale>
          </PopIn>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: { position: "absolute", right: 16, bottom: 16 },
  fabShadow: { borderRadius: 999 },
});
