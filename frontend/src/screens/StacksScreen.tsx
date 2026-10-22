import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Stack } from "../api/contract";
import { useApi } from "../api/index";
import { CategoryDot } from "../components/CategoryDot";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { Icon } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { StackCollage } from "../components/StackCollage";
import { useNow } from "../hooks/useNow";
import { useMe } from "../hooks/useSaves";
import { countOf } from "../lib/counts";
import { relativeShort } from "../lib/dates";
import { GRID_GAP, GRID_MAX_WIDTH, GRID_SIDE, gridLayout } from "../lib/grid";
import { haptic } from "../lib/haptics";
import { CATEGORY } from "../theme/categories";
import { useTheme } from "../theme/ThemeProvider";
import { NewStackSheet } from "./NewStackSheet";

/** "1 save", "4 saves": a stack holds the user's saves (the reel is the Instagram video). */
export const savesCount = (n: number) => countOf(n, "save");

/** Media radius for a stack's cover: the same 12 as a card's tile. */
const COVER_RADIUS = 12;

export function StacksScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();
  const me = useMe().data;
  const stacks = useQuery({ queryKey: ["stacks"], queryFn: () => api.listStacks() });
  const [newOpen, setNewOpen] = useState(false);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });
  const entrance = useEntranceWindow("stacks", !stacks.isLoading);

  const { columns, itemWidth } = gridLayout(width);
  const loaded = stacks.data;

  const renderItem = useCallback(
    ({ item, index }: { item: Stack; index: number }) => {
      // The category as a word, not only a colour dot: the dot is decoration, the word is the fact.
      const category = item.category ? CATEGORY[item.category].short : null;
      const meta = [savesCount(item.save_count), category, `updated ${relativeShort(item.updated_at, now)}`]
        .filter(Boolean)
        .join(" · ");
      return (
        <Reveal index={index} enabled={entrance}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${meta}`}
            onPress={() => router.push(`/stack/${item.id}`)}
            containerStyle={{ width: itemWidth }}
          >
            <StackCollage covers={item.cover_urls} radius={COVER_RADIUS} />
            <Text numberOfLines={2} className="mt-2 font-sans-semibold text-body text-ink">
              {item.name}
            </Text>
            <View className="mt-0.5 flex-row items-start">
              {item.category ? (
                <View className="mr-1.5 mt-[6px]">
                  <CategoryDot category={item.category} />
                </View>
              ) : null}
              <Text numberOfLines={2} className="flex-1 font-sans text-meta text-ink-2">
                {meta}
              </Text>
            </View>
          </PressableScale>
        </Reveal>
      );
    },
    [entrance, itemWidth, now, router],
  );

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <Header
        avatarUrl={me?.avatar_url}
        initial={me?.name?.[0]}
        onAvatar={() => router.push("/account")}
        scrollY={scrollY}
      />
      <Animated.FlatList
        key={`stacks-${columns}`}
        data={loaded ?? []}
        keyExtractor={(s: Stack) => s.id}
        numColumns={columns}
        columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_SIDE, alignSelf: "center", width: "100%", maxWidth: GRID_MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 48, gap: GRID_GAP }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View className="w-full flex-row items-center self-center px-4 pt-3" style={{ maxWidth: GRID_MAX_WIDTH }}>
            <View className="flex-1">
              <Text accessibilityRole="header" className="font-display text-display-lg text-ink">
                Stacks
              </Text>
              <Text className="mt-0.5 font-sans text-meta text-ink-2">Your saves, grouped your way.</Text>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Create a new stack"
              onPress={() => setNewOpen(true)}
              scaleTo={0.95}
              highlightColor={colors.raised}
              className="h-9 flex-row items-center justify-center rounded-full border border-hairline bg-card pl-2.5 pr-3.5"
            >
              <Icon name="add" size={18} color={colors.ink} />
              <Text className="ml-1 font-sans-semibold text-meta text-ink">New stack</Text>
            </PressableScale>
          </View>
        }
        ListEmptyComponent={
          stacks.isLoading ? (
            <SkeletonGroup style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, paddingHorizontal: GRID_SIDE, alignSelf: "center", width: "100%", maxWidth: GRID_MAX_WIDTH }}>
              {Array.from({ length: columns * 2 }, (_, i) => (
                <View key={i} style={{ width: itemWidth }}>
                  <Skeleton style={{ aspectRatio: 1, borderRadius: COVER_RADIUS }} />
                  <Skeleton style={{ marginTop: 10, height: 14, width: "70%", borderRadius: 7 }} />
                  <Skeleton style={{ marginTop: 6, height: 11, width: "50%", borderRadius: 6 }} />
                </View>
              ))}
            </SkeletonGroup>
          ) : loaded ? (
            // The only place the dashed tile shows. With stacks, the header button is the way in.
            <Reveal>
              <View className="w-full self-center px-4" style={{ maxWidth: GRID_MAX_WIDTH }}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="New stack"
                  onPress={() => setNewOpen(true)}
                  highlightColor={colors.raised}
                  containerStyle={{ width: itemWidth, aspectRatio: 1 }}
                  className="grow items-center justify-center rounded-ctl border-2 border-dashed border-hairline"
                >
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-raised">
                    <Icon name="add" size={24} color={colors.ink2} />
                  </View>
                  <Text className="mt-3 font-sans-medium text-body text-ink">New stack</Text>
                </PressableScale>
                <Text className="mt-3 font-sans text-meta text-ink-2">Stacks group saves. Make one to start.</Text>
              </View>
            </Reveal>
          ) : null
        }
        ListFooterComponent={
          stacks.isError && !stacks.data ? (
            <ErrorState title="Couldn't load your stacks" onRetry={() => stacks.refetch()} retrying={stacks.isRefetching} />
          ) : null
        }
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={stacks.isRefetching}
            onRefresh={() => {
              haptic.light();
              stacks.refetch();
            }}
            tintColor={colors.accentText}
            colors={[colors.accentText]}
            progressBackgroundColor={colors.card}
          />
        }
      />
      <NewStackSheet visible={newOpen} onClose={() => setNewOpen(false)} />
    </View>
  );
}
