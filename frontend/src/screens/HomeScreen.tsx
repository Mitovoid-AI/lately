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
import { AttentionBanner, QUOTA_BANNER_AT, QueuedBanner, QuotaBanner } from "../components/home/Banners";
import { FirstRun } from "../components/home/FirstRun";
import { SearchFrontDoor } from "../components/home/SearchFrontDoor";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { ReelCard } from "../components/ReelCard";
import { SkeletonGrid } from "../components/Skeleton";
import { useNow } from "../hooks/useNow";
import { useSaveQueue } from "../hooks/useSaveQueue";
import { needsRetry, useCategoryCounts, useMe, useSaves } from "../hooks/useSaves";
import { countOf } from "../lib/counts";
import { GRID_GAP, GRID_MAX_WIDTH, GRID_SIDE, gridLayout, memoryTileWidth } from "../lib/grid";
import { haptic } from "../lib/haptics";
import { CATEGORY_ORDER, categoryColor } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";

/** The search field and the banners stay a phone-sized column on a tablet. */
const TOP_WIDTH = 560;

/**
 * Home, top to bottom: the search field that fronts the Search tab, the banners (Pro near the
 * limit, saves waiting offline, saves that need another try), "Back for you", then category
 * chips (when there is more than one category) and the grid of everything saved. A card being
 * written is a tile in that grid (it carries the step it is on), not a bar of its own. With
 * nothing saved it shows the
 * first-run picture instead. Saving itself is the Save tab; there is no floating button here.
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
  const counts = useCategoryCounts().data;
  const queue = useSaveQueue();
  const [filter, setFilter] = useState<Category | "All">("All");
  // "2 saves need another try": tapping it shows just those saves; the cross hides it for the
  // session (Home stays mounted as a tab) until a save it hasn't counted needs a try too.
  const [retryView, setRetryView] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  // Chips are the person's categories from the server, most used first, so a category only older
  // saves have still gets one. A card that has only just finished (Home polls the list) may bring
  // one the server's list hasn't caught up with yet: it joins at the end until the next refresh.
  // Without the server's list (an older server) the loaded saves decide, as before.
  const categories = useMemo(() => {
    const known = (counts ?? []).map((c) => c.category).filter((c) => CATEGORY_ORDER.includes(c));
    const fresh = CATEGORY_ORDER.filter(
      (c) => !known.includes(c) && saves.some((s) => s.status !== "pending" && s.category === c),
    );
    return [...known, ...fresh];
  }, [counts, saves]);
  // Only saves another try could help; a pending one still within the usual time is not one.
  const attention = useMemo(() => saves.filter((s) => needsRetry(s, now)), [saves, now]);
  const showingRetry = retryView && attention.length > 0;
  const noticeShown = !showingRetry && attention.some((s) => !dismissed.has(s.id));
  // One category is no choice: chips need two or more, and a filter left over from before the
  // library shrank to one falls back to everything.
  const showChips = categories.length > 1;
  const active = filter !== "All" && !(showChips && categories.includes(filter)) ? "All" : filter;
  const filtered = useSaves(active === "All" ? undefined : active);
  const list = active === "All" ? all : filtered;
  const { isLoading, fetchNextPage, refetch, isRefetching } = list;
  const shown = showingRetry ? attention : list.saves;
  const view = showingRetry ? "retry" : active;
  const failed = list.isError;

  const { columns, itemWidth } = gridLayout(width);
  const empty = !all.isLoading && !all.isError && saves.length === 0;
  const paste = useCallback(() => router.push("/save-sheet"), [router]);

  // Cards stagger in when content arrives and again for each new filter; cards mounted later
  // by scrolling simply appear, so the list never flickers.
  const entrance = useEntranceWindow(view, !isLoading);

  // Scroll drives the header hairline.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  const pick = useCallback((c: Category | "All") => {
    setRetryView(false);
    setFilter(c);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Save; index: number }) => (
      <Reveal index={index} enabled={entrance} style={{ width: itemWidth }}>
        <ReelCard save={item} now={now} href={`/reel/${item.id}`} />
      </Reveal>
    ),
    [entrance, itemWidth, now],
  );

  const listHeader = (
    <View className="w-full self-center" style={{ maxWidth: GRID_MAX_WIDTH }}>
      <View className="w-full self-center px-4 pt-1" style={{ maxWidth: TOP_WIDTH }}>
        {/* Nothing saved means nothing to search: the first-run picture takes the stage. */}
        {empty ? null : <SearchFrontDoor onPress={() => router.push("/search")} />}
        {me && me.plan === "free" && me.saves_limit - me.saves_this_month <= QUOTA_BANNER_AT ? (
          <QuotaBanner left={Math.max(me.saves_limit - me.saves_this_month, 0)} onUpgrade={() => router.push("/pro")} />
        ) : null}
        {queue.queued.length > 0 ? (
          <QueuedBanner count={queue.queued.length} busy={queue.flushing} onRetry={() => queue.flush()} />
        ) : null}
        {noticeShown ? (
          <AttentionBanner
            count={attention.length}
            onShow={() => {
              setFilter("All");
              setRetryView(true);
            }}
            onDismiss={() => setDismissed((d) => new Set([...d, ...attention.map((s) => s.id)]))}
          />
        ) : null}
      </View>
      {/* Showing the saves that need a try puts them straight under the notice that led here. */}
      {empty || failed || showingRetry ? null : (
        <BackForYou
          onOpen={(href) => router.push(href)}
          onSeeAll={() => router.push("/curated")}
          tileWidth={memoryTileWidth(itemWidth)}
        />
      )}
      {empty ? null : (
        <>
          {showChips ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: GRID_SIDE, gap: 8 }}
              className="mt-4"
            >
              <Chip label="All" active={view === "All"} haptic="selection" onPress={() => pick("All")} />
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  dotColor={categoryColor(c, scheme)}
                  active={view === c}
                  haptic="selection"
                  onPress={() => pick(c)}
                />
              ))}
            </ScrollView>
          ) : null}
          <View className={`mt-3 flex-row ${showingRetry ? "items-center" : "items-baseline"} justify-between px-4`}>
            <Text accessibilityRole="header" className="font-display text-display-sm text-ink">
              {showingRetry ? "Need another try" : active === "All" ? "Recently saved" : active}
            </Text>
            {showingRetry ? (
              <PressableScale
                accessibilityRole="button"
                onPress={() => setRetryView(false)}
                scaleTo={0.96}
                className="-mr-2 h-11 justify-center px-2"
              >
                <Text className="font-sans-semibold text-body text-ink">Show all</Text>
              </PressableScale>
            ) : me && active === "All" ? (
              <Text className="font-sans text-meta text-ink-2">{countOf(me.total_saves, "save")}</Text>
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
        keyExtractor={(s: Save) => `${view}:${s.id}`}
        numColumns={columns}
        columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_SIDE, alignSelf: "center", width: "100%", maxWidth: GRID_MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 32, gap: GRID_GAP }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonGrid columns={columns} itemWidth={itemWidth} />
          ) : failed ? (
            <ErrorState title="Couldn't load your saves" onRetry={() => refetch()} retrying={isRefetching} />
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
