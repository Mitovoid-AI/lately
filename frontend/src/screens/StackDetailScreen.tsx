import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "../api/index";
import { Icon } from "../components/Icon";
import { ReelCard } from "../components/ReelCard";
import { useNow } from "../hooks/useNow";
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

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center border-b border-hairline px-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/stacks"))}
          className="h-12 w-12 items-center justify-center"
        >
          <Icon name="arrow-back" size={24} color={colors.ink} />
        </Pressable>
        <Text className="font-sans-semibold text-body text-ink">Stacks</Text>
      </View>
      {stack.isLoading ? (
        <ActivityIndicator className="mt-12" color={colors.accent} />
      ) : !stack.data ? (
        <Text className="mt-12 text-center font-sans text-body text-ink-2">{"This stack isn't here anymore."}</Text>
      ) : (
        <FlatList
          key={`stack-${columns}`}
          data={stack.data.saves}
          keyExtractor={(s) => s.id}
          numColumns={columns}
          columnWrapperStyle={{ gap: GAP, paddingHorizontal: 16, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: 20 }}
          ListHeaderComponent={
            <View className="w-full self-center px-4 pt-5" style={{ maxWidth: MAX_WIDTH }}>
              <Text className="font-display text-display-lg text-ink">{stack.data.name}</Text>
              <Text className="mt-1 font-sans text-meta text-ink-2">{reelsCount(stack.data.save_count)}</Text>
            </View>
          }
          ListEmptyComponent={
            <Text className="px-6 pt-10 text-center font-sans text-body text-ink-2">
              {"No reels here yet — add one from a card's bookmark."}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={{ width: itemWidth }}>
              <ReelCard save={item} now={now} onPress={() => router.push(`/reel/${item.id}`)} />
            </View>
          )}
        />
      )}
    </View>
  );
}
