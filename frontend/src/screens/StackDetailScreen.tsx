import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Save } from "../api/contract";
import { useApi } from "../api/index";
import { ScrollHairline } from "../components/Header";
import { IconButton } from "../components/motion/IconButton";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { ReelCard } from "../components/ReelCard";
import { Skeleton, SkeletonGrid } from "../components/Skeleton";
import { useNow } from "../hooks/useNow";
import { haptic } from "../lib/haptics";
import { colors } from "../theme/tokens";
import { reelsCount } from "./StacksScreen";

const MAX_WIDTH = 1280;
const GAP = 12;

export function StackDetailScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();
  const stack = useQuery({ queryKey: ["stack", id], queryFn: () => api.getStack(id) });
  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;
  const itemWidth = (Math.min(width, MAX_WIDTH) - 32 - GAP * (columns - 1)) / columns;
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });
  const entrance = useEntranceWindow(id, !stack.isLoading);

  const renderItem = useCallback(
    ({ item, index }: { item: Save; index: number }) => (
      <Reveal index={index} enabled={entrance} style={{ width: itemWidth }}>
        <ReelCard save={item} now={now} href={`/reel/${item.id}`} />
      </Reveal>
    ),
    [entrance, itemWidth, now],
  );

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center px-2">
        <IconButton
          icon="arrow-back"
          size={24}
          color={colors.ink}
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/stacks"))}
        />
        <Text className="font-sans-semibold text-body text-ink">Stacks</Text>
        <ScrollHairline scrollY={scrollY} />
      </View>
      {stack.isLoading ? (
        <View>
          <View className="w-full self-center px-4 pb-5 pt-5" style={{ maxWidth: MAX_WIDTH }}>
            <Skeleton style={{ height: 30, width: "60%", borderRadius: 8 }} />
            <Skeleton style={{ marginTop: 10, height: 12, width: 64, borderRadius: 6 }} />
          </View>
          <SkeletonGrid columns={columns} itemWidth={itemWidth} />
        </View>
      ) : !stack.data ? (
        <Reveal>
          <Text className="mt-12 text-center font-sans text-body text-ink-2">{"This stack isn't here anymore."}</Text>
        </Reveal>
      ) : (
        <Animated.FlatList
          key={`stack-${columns}`}
          data={stack.data.saves}
          keyExtractor={(s: Save) => s.id}
          numColumns={columns}
          columnWrapperStyle={{ gap: GAP, paddingHorizontal: 16, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: 20 }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <Reveal style={{ width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center" }}>
              <View className="px-4 pt-5">
                <Text className="font-display text-display-lg text-ink">{stack.data.name}</Text>
                <Text className="mt-1 font-sans text-meta text-ink-2">{reelsCount(stack.data.save_count)}</Text>
              </View>
            </Reveal>
          }
          ListEmptyComponent={
            <Reveal index={1}>
              <Text className="px-6 pt-10 text-center font-sans text-body text-ink-2">
                {"No reels here yet — add one from a card's bookmark."}
              </Text>
            </Reveal>
          }
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={stack.isRefetching}
              onRefresh={() => {
                haptic.light();
                stack.refetch();
              }}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.card}
            />
          }
        />
      )}
    </View>
  );
}
