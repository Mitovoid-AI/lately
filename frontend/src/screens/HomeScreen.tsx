import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Category, Save } from "../api/contract";
import { Chip } from "../components/Chip";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { BackForYou } from "../components/home/BackForYou";
import { QUOTA_BANNER_AT, QueuedBanner, QuotaBanner } from "../components/home/Banners";
import { FirstRun } from "../components/home/FirstRun";
import { LiveCardBar } from "../components/home/LiveCardBar";
import { SearchFrontDoor } from "../components/home/SearchFrontDoor";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { ReelCard } from "../components/ReelCard";
import { SkeletonGrid } from "../components/Skeleton";
import { useNow } from "../hooks/useNow";
import { useSaveQueue } from "../hooks/useSaveQueue";
import { isStalePending, useMe, useSaves } from "../hooks/useSaves";
import { countOf } from "../lib/counts";
import { haptic } from "../lib/haptics";
import { CATEGORY_ORDER, categoryColor } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";

const MAX_WIDTH = 1280;
const GAP = 12;
const SIDE = 16;

/**
 * Home, top to bottom: the search field that fronts the Search tab, the banners (Pro near the
 * limit, saves waiting offline), cards being written right now, "Back for you", then category
 * chips and the grid of everything saved. With nothing saved it shows the first-run picture
 * instead. Saving itself is the Save tab; there is no floating button here.
 */
export function HomeScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
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
  // A job that has run for 10+ minutes has most likely died: it is not "live" any more (its
  // card in the grid offers Try again), so it gets no row up here.
  const pending = useMemo(
    () => saves.filter((s) => s.status === "pending" && !isStalePending(s, now)),
    [saves, now],
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

  // Scroll drives the header hairline.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

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
        {/* Nothing saved means nothing to search: the first-run picture takes the stage. */}
        {empty ? null : <SearchFrontDoor onPress={() => router.push("/search")} />}
        {me && me.plan === "free" && me.saves_limit - me.saves_this_month <= QUOTA_BANNER_AT ? (
          <QuotaBanner left={Math.max(me.saves_limit - me.saves_this_month, 0)} onUpgrade={() => router.push("/pro")} />
        ) : null}
        {queue.queued.length > 0 ? (
          <QueuedBanner count={queue.queued.length} busy={queue.flushing} onRetry={() => queue.flush()} />
        ) : null}
        <LiveCardBar saves={pending} now={now} onOpen={(id) => router.push(`/reel/${id}`)} />
      </View>
      {empty || failed ? null : (
        <BackForYou onOpen={(href) => router.push(href)} onSeeAll={() => router.push("/curated")} />
      )}
      {empty ? null : (
        <>
          {categories.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SIDE, gap: 8 }}
              className="mt-6"
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
          <View className="mt-5 flex-row items-baseline justify-between px-4">
            <Text className="font-display text-display-sm text-ink">{active === "All" ? "Recently saved" : active}</Text>
            {me && active === "All" ? (
              <Text className="font-sans text-meta text-ink-2">{countOf(me.total_saves, "reel")}</Text>
            ) : null}
          </View>
        </>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <Header avatarUrl={me?.avatar_url} initial={me?.name?.[0]} onAvatar={() => router.push("/account")} scrollY={scrollY} />
      <Animated.FlatList
        key={`grid-${columns}`}
        data={empty || failed ? [] : shown}
        keyExtractor={(s: Save) => `${active}:${s.id}`}
        numColumns={columns}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: SIDE, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 32, gap: 16 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonGrid columns={columns} itemWidth={itemWidth} />
          ) : failed ? (
            <ErrorState title="Couldn't load your reels" onRetry={() => refetch()} retrying={isRefetching} />
          ) : empty ? (
            <FirstRun onPaste={paste} />
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
              // "Back for you" follows the same pull.
              void queryClient.invalidateQueries({ queryKey: ["curated"] });
            }}
            tintColor={colors.accentText}
            colors={[colors.accentText]}
            progressBackgroundColor={colors.card}
          />
        }
      />
    </View>
  );
}
