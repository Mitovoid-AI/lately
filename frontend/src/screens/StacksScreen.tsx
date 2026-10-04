import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Stack } from "../api/contract";
import { useApi } from "../api/index";
import { CategoryDot } from "../components/CategoryDot";
import { Header } from "../components/Header";
import { Icon } from "../components/Icon";
import { StackCollage } from "../components/StackCollage";
import { useNow } from "../hooks/useNow";
import { useMe } from "../hooks/useSaves";
import { relativeShort } from "../lib/dates";
import { colors } from "../theme/tokens";
import { NewStackSheet } from "./NewStackSheet";

const MAX_WIDTH = 1280;
const GAP = 12;
const NEW = "__new";

export const reelsCount = (n: number) => (n === 1 ? "1 reel" : `${n} reels`);

export function StacksScreen() {
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();
  const me = useMe().data;
  const stacks = useQuery({ queryKey: ["stacks"], queryFn: () => api.listStacks() });
  const [newOpen, setNewOpen] = useState(false);

  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;
  const itemWidth = (Math.min(width, MAX_WIDTH) - 32 - GAP * (columns - 1)) / columns;
  const data: (Stack | { id: typeof NEW })[] = [...(stacks.data ?? []), { id: NEW }];

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <Header
        avatarUrl={me?.avatar_url}
        initial={me?.name?.[0]}
        onAvatar={() => router.push("/account")}
        onBookmark={() => router.push("/stacks")}
      />
      <FlatList
        key={`stacks-${columns}`}
        data={stacks.isLoading ? [] : data}
        keyExtractor={(s) => s.id}
        numColumns={columns}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: 16, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 48, gap: 20 }}
        ListHeaderComponent={
          <View className="w-full flex-row items-start self-center px-4 pt-5" style={{ maxWidth: MAX_WIDTH }}>
            <View className="flex-1">
              <Text className="font-display-regular text-ink" style={{ fontSize: 32, lineHeight: 38 }}>
                Stacks
              </Text>
              <Text className="mt-1 font-sans text-body text-ink-2">Your saves, grouped your way.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setNewOpen(true)}
              className="h-11 items-center justify-center rounded-full border border-accent px-4 active:bg-raised"
            >
              <Text className="font-sans-semibold text-body text-accent">+ New stack</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={stacks.isLoading ? <ActivityIndicator className="mt-12" color={colors.accent} /> : null}
        renderItem={({ item }) =>
          item.id === NEW ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New stack"
              onPress={() => setNewOpen(true)}
              style={{ width: itemWidth, aspectRatio: 1 }}
              className="items-center justify-center rounded-thumb border-2 border-dashed border-hairline active:bg-raised"
            >
              <View className="h-12 w-12 items-center justify-center rounded-full bg-raised">
                <Icon name="add" size={24} color={colors.ink2} />
              </View>
              <Text className="mt-3 font-sans-medium text-body text-ink">New stack</Text>
              <Text className="mt-0.5 font-sans text-meta text-ink-2">Create collection</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/stack/${item.id}`)}
              style={{ width: itemWidth }}
              className="active:opacity-90"
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
            </Pressable>
          )
        }
      />
      <NewStackSheet visible={newOpen} onClose={() => setNewOpen(false)} />
    </View>
  );
}
