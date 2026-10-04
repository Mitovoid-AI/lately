import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Category } from "../api/contract";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Header } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { ReelCard } from "../components/ReelCard";
import { useNow } from "../hooks/useNow";
import { useMe, useSaves } from "../hooks/useSaves";
import { CATEGORY, CATEGORY_ORDER } from "../theme/categories";
import { colors } from "../theme/tokens";

const MAX_WIDTH = 1280;
const GAP = 12;
const SIDE = 16;

function SearchField({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="search"
      onPress={onPress}
      className="h-12 flex-row items-center rounded-xl border border-hairline bg-card px-3"
    >
      <Icon name="search" size={22} color={colors.ink2} />
      <Text className="ml-2 flex-1 font-sans text-body text-ink-2">Search what you remember...</Text>
      <Icon name="mic" size={22} color={colors.ink3} />
    </Pressable>
  );
}

function EmptyState({ onPaste }: { onPaste: () => void }) {
  const steps: { icon: IconName; text: string }[] = [
    { icon: "play-circle-outline", text: "Open a reel in Instagram" },
    { icon: "ios-share", text: "Tap Share → Lately" },
    { icon: "edit-note", text: "Add a reason — optional" },
  ];
  return (
    <View className="items-center px-6 pt-12">
      <Text className="text-center font-display text-display-lg text-ink">Your Lately is empty — for now</Text>
      <Text className="mt-2 text-center font-sans text-body text-ink-2">
        Save a reel from Instagram and it shows up here.
      </Text>
      <View className="mt-8 w-full max-w-[340px] gap-3">
        {steps.map((s, i) => (
          <View key={s.text} className="flex-row items-center rounded-2xl border border-hairline bg-card p-4">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-raised">
              <Text className="font-sans-semibold text-body text-accent">{i + 1}</Text>
            </View>
            <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">{s.text}</Text>
            <Icon name={s.icon} size={22} color={colors.ink3} />
          </View>
        ))}
      </View>
      <Button title="Paste a link instead" variant="secondary" icon="link" onPress={onPaste} className="mt-8 w-full max-w-[340px]" />
    </View>
  );
}

export function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();
  const { saves, isLoading, fetchNextPage, refetch, isRefetching } = useSaves();
  const me = useMe().data;
  const [filter, setFilter] = useState<Category | "All">("All");

  const categories = useMemo(
    () => CATEGORY_ORDER.filter((c) => saves.some((s) => s.status !== "pending" && s.category === c)),
    [saves],
  );
  const active = filter !== "All" && !categories.includes(filter) ? "All" : filter;
  const shown = active === "All" ? saves : saves.filter((s) => s.status !== "pending" && s.category === active);

  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;
  const inner = Math.min(width, MAX_WIDTH) - SIDE * 2;
  const itemWidth = (inner - GAP * (columns - 1)) / columns;
  const empty = !isLoading && saves.length === 0;
  const paste = () => router.push("/save-sheet");

  const listHeader = (
    <View className="w-full self-center" style={{ maxWidth: MAX_WIDTH }}>
      <View className="px-4 pt-2">
        <SearchField onPress={() => router.push("/search")} />
      </View>
      {empty ? null : (
        <>
          {categories.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SIDE, gap: 8 }} className="mt-3">
              <Chip label="All" active={active === "All"} onPress={() => setFilter("All")} />
              {categories.map((c) => (
                <Chip key={c} label={c} dotColor={CATEGORY[c].color} active={active === c} onPress={() => setFilter(c)} />
              ))}
            </ScrollView>
          ) : null}
          <View className="mt-5 flex-row items-center justify-between px-4">
            <Text className="font-sans-semibold text-label text-ink-2">RECENTLY SAVED</Text>
            {me ? <Text className="font-sans text-meta text-ink-2">{`${me.total_saves} reels`}</Text> : null}
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
      />
      <FlatList
        key={`grid-${columns}`}
        data={empty ? [] : shown}
        keyExtractor={(s) => s.id}
        numColumns={columns}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: SIDE, alignSelf: "center", width: "100%", maxWidth: MAX_WIDTH }}
        contentContainerStyle={{ paddingBottom: 120, gap: 20 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator className="mt-12" color={colors.accent} />
          ) : empty ? (
            <EmptyState onPaste={paste} />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ width: itemWidth }}>
            <ReelCard save={item} now={now} onPress={() => router.push(`/reel/${item.id}`)} />
          </View>
        )}
        onEndReached={fetchNextPage}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      />
      {empty ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={paste}
          className="absolute bottom-4 right-4 h-12 flex-row items-center rounded-full bg-accent pl-3.5 pr-4 active:opacity-90"
          style={{ shadowColor: colors.accent, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } }}
        >
          <Icon name="add" size={22} color={colors.onAccent} />
          <Text className="ml-1.5 font-sans-semibold text-meta text-on-accent">Paste link</Text>
        </Pressable>
      )}
    </View>
  );
}
