import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, type Save, type StackDetail } from "../api/contract";
import { useApi } from "../api/index";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { HEADER_HEIGHT, ScrollHairline } from "../components/Header";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { cardTitle, ReelCard } from "../components/ReelCard";
import { Skeleton, SkeletonGrid } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useNow } from "../hooks/useNow";
import { pollWhilePending } from "../hooks/useSaves";
import { GRID_GAP, GRID_MAX_WIDTH, GRID_SIDE, gridLayout } from "../lib/grid";
import { haptic } from "../lib/haptics";
import { goBack } from "../lib/navigation";
import { useTheme } from "../theme/ThemeProvider";
import { savesCount } from "./StacksScreen";

export function StackDetailScreen() {
  const { colors } = useTheme();
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();
  const stack = useQuery({
    queryKey: ["stack", id],
    queryFn: () => api.getStack(id),
    refetchInterval: (q) => pollWhilePending(q.state.data?.saves),
  });
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { columns, itemWidth } = gridLayout(width);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });
  const entrance = useEntranceWindow(id, !stack.isLoading);

  const remove = useCallback(
    async (save: Save) => {
      // The card leaves at once; a failure brings it back.
      const key = ["stack", id];
      const before = queryClient.getQueryData<StackDetail>(key);
      queryClient.setQueryData<StackDetail>(key, (old) =>
        old
          ? { ...old, saves: old.saves.filter((s) => s.id !== save.id), save_count: Math.max(0, old.save_count - 1) }
          : old,
      );
      haptic.light();
      try {
        await api.removeFromStack(id, save.id);
        queryClient.invalidateQueries({ queryKey: ["stacks"] });
      } catch {
        queryClient.setQueryData(key, before);
        haptic.error();
        toast.show("Couldn't remove it. Try again.");
      }
    },
    [api, id, queryClient, toast],
  );

  async function deleteStack() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteStack(id);
      haptic.medium();
      setConfirmOpen(false);
      queryClient.removeQueries({ queryKey: ["stack", id], exact: true });
      queryClient.invalidateQueries({ queryKey: ["stacks"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.show("Stack deleted");
      router.replace("/stacks");
    } catch {
      haptic.error();
      toast.show("Couldn't delete the stack. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  const renderItem = useCallback(
    ({ item, index }: { item: Save; index: number }) => (
      <Reveal index={index} enabled={entrance} style={{ width: itemWidth }}>
        <ReelCard save={item} now={now} href={`/reel/${item.id}`} />
        {editing ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Remove ${cardTitle(item)} from this stack`}
            onPress={() => remove(item)}
            scaleTo={0.9}
            // Top-left: the card's category badge sits top-right.
            containerStyle={{ position: "absolute", top: 8, left: 8 }}
            className="h-9 w-9 items-center justify-center rounded-full border border-hairline bg-card"
          >
            <Icon name="remove-circle-outline" size={20} color={colors.danger} />
          </PressableScale>
        ) : null}
      </Reveal>
    ),
    [entrance, itemWidth, now, editing, remove, colors],
  );

  const gone = stack.error instanceof ApiError && stack.error.code === "NOT_FOUND";
  const data = stack.data;

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-1" style={{ height: HEADER_HEIGHT }}>
        <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={() => goBack(router, "/stacks")} />
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} className="flex-1 font-sans-semibold text-body text-ink">
          Stacks
        </Text>
        {data ? (
          <>
            {data.saves.length > 0 ? (
              <PressableScale
                accessibilityRole="button"
                onPress={() => setEditing((e) => !e)}
                scaleTo={0.95}
                highlightColor={colors.raised}
                className="h-10 justify-center rounded-full px-3"
              >
                <Text className="font-sans-semibold text-body text-ink">{editing ? "Done" : "Edit"}</Text>
              </PressableScale>
            ) : null}
            <IconButton icon="delete-outline" label="Delete stack" onPress={() => setConfirmOpen(true)} />
          </>
        ) : null}
        <ScrollHairline scrollY={scrollY} />
      </View>
      {stack.isLoading ? (
        <View>
          <View className="w-full self-center px-4 pb-5 pt-5" style={{ maxWidth: GRID_MAX_WIDTH }}>
            <Skeleton style={{ height: 30, width: "60%", borderRadius: 8 }} />
            <Skeleton style={{ marginTop: 10, height: 12, width: 64, borderRadius: 6 }} />
          </View>
          <SkeletonGrid columns={columns} itemWidth={itemWidth} />
        </View>
      ) : !data ? (
        gone ? (
          <ErrorState icon="search-off" title="This stack isn't here anymore" body="It may have been deleted." />
        ) : (
          <ErrorState title="Couldn't load this stack" onRetry={() => stack.refetch()} retrying={stack.isRefetching} />
        )
      ) : (
        <Animated.FlatList
          key={`stack-${columns}`}
          data={data.saves}
          keyExtractor={(s: Save) => s.id}
          numColumns={columns}
          columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_SIDE, alignSelf: "center", width: "100%", maxWidth: GRID_MAX_WIDTH }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: GRID_GAP }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <Reveal style={{ width: "100%", maxWidth: GRID_MAX_WIDTH, alignSelf: "center" }}>
              <View className="px-4 pt-5">
                <Text accessibilityRole="header" className="font-display text-display-lg text-ink">
                  {data.name}
                </Text>
                <Text className="mt-1 font-sans text-meta text-ink-2">{savesCount(data.save_count)}</Text>
              </View>
            </Reveal>
          }
          ListEmptyComponent={
            <Reveal index={1}>
              <Text className="px-6 pt-10 text-center font-sans text-body text-ink-2">
                {"No saves here yet. Open a card and tap Add to stack."}
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
              tintColor={colors.accentText}
              colors={[colors.accentText]}
              progressBackgroundColor={colors.card}
            />
          }
        />
      )}

      <ConfirmDialog
        visible={confirmOpen}
        title={`Delete “${data?.name ?? "this stack"}”?`}
        message="The stack goes away; its reels stay saved."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={deleteStack}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}
