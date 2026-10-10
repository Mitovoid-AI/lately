import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Stack } from "../api/contract";
import { useApi } from "../api/index";
import { CategoryDot } from "../components/CategoryDot";
import { Header } from "../components/Header";
import { Icon } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { StackCollage } from "../components/StackCollage";
import { useNow } from "../hooks/useNow";
import { useMe } from "../hooks/useSaves";
import { relativeShort } from "../lib/dates";
import { haptic } from "../lib/haptics";
import { colors } from "../theme/tokens";
import { NewStackSheet } from "./NewStackSheet";
import { ErrorState } from "../components/ErrorState";

const MAX_WIDTH = 1280;
const GAP = 12;
const NEW = "__new";

export const reelsCount = (n: number) => (n === 1 ? "1 reel" : `${n} reels`);

type Item = Stack | { id: typeof NEW };

export function StacksScreen() {
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

  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;
  const itemWidth = (Math.min(width, MAX_WIDTH) - 32 - GAP * (columns - 1)) / columns;
  const data: Item[] = [...(stacks.data ?? []), { id: NEW }];

  const renderItem = useCallback(
    ({ item, index }: { item: Item; index: number }) => (
      <Reveal index={index} enabled={entrance}>
        {item.id === NEW ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="New stack"
            onPress={() => setNewOpen(true)}
            highlightColor={colors.raised}
            containerStyle={{ width: itemWidth, aspectRatio: 1 }}
            className="grow items-center justify-center rounded-thumb border-2 border-dashed border-hairline"
          >
            <View className="h-12 w-12 items-center justify-center rounded-full bg-raised">
              <Icon name="add" size={24} color={colors.ink2} />
            </View>
            <Text className="mt-3 font-sans-medium text-body text-ink">New stack</Text>
            <Text className="mt-0.5 font-sans text-meta text-ink-2">Create collection</Text>
          </PressableScale>
        ) : (
          <PressableScale
            accessibilityRole="button"
            onPress={() => router.push(`/stack/${item.id}`)}
            containerStyle={{ width: itemWidth }}
          >
            <StackCollage covers={(item as Stack).cover_urls} />
            <Text numberOfLines={1} className="mt-2 font-sans-semibold text-body text-ink">
              {(item as Stack).name}
            </Text>
            <View className="mt-0.5 flex-row items-center">
              {(item as Stack).category ? (
                <View className="mr-1.5">
                  <CategoryDot category={(item as Stack).category!} />
                </View>
              ) : null}
              <Text numberOfLines={1} className="flex-1 font-sans text-meta text-ink-2">
                {`${reelsCount((item as Stack).save_count)} · updated ${relativeShort((item as Stack).updated_at, now)}`}
              </Text>
            </View>
          </PressableScale>
        )}
      </Reveal>
    ),
    [entrance, itemWidth, now, router],
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
        key={`stacks-${columns}`}
        data={stacks.isLoading || (stacks.isError && !stacks.data) ? [] : data}
        keyExtractor={(s: Item) => s.id}
        numColumns={columns}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: 16, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 48, gap: 20 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View className="w-full flex-row items-start self-center px-4 pt-5" style={{ maxWidth: MAX_WIDTH }}>
            <View className="flex-1">
              <Text className="font-display-regular text-ink" style={{ fontSize: 32, lineHeight: 38 }}>
                Stacks
              </Text>
              <Text className="mt-1 font-sans text-body text-ink-2">Your saves, grouped your way.</Text>
            </View>
            <PressableScale
              accessibilityRole="button"
              onPress={() => setNewOpen(true)}
              scaleTo={0.95}
              highlightColor={colors.raised}
              className="h-11 items-center justify-center rounded-full border border-accent px-4"
            >
              <Text className="font-sans-semibold text-body text-accent">+ New stack</Text>
            </PressableScale>
          </View>
        }
        ListEmptyComponent={
          stacks.isLoading ? (
            <SkeletonGroup style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingHorizontal: 16, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}>
              {Array.from({ length: columns * 2 }, (_, i) => (
                <View key={i} style={{ width: itemWidth }}>
                  <Skeleton style={{ aspectRatio: 1, borderRadius: 14 }} />
                  <Skeleton style={{ marginTop: 10, height: 14, width: "70%", borderRadius: 7 }} />
                  <Skeleton style={{ marginTop: 6, height: 11, width: "50%", borderRadius: 6 }} />
                </View>
              ))}
            </SkeletonGroup>
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
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        }
      />
      <NewStackSheet visible={newOpen} onClose={() => setNewOpen(false)} />
    </View>
  );
}
