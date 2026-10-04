import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SearchHit } from "../api/contract";
import { useApi } from "../api/index";
import { Chip } from "../components/Chip";
import { Icon } from "../components/Icon";
import { cardTitle } from "../components/ReelCard";
import { Thumb } from "../components/Thumb";
import { useNow } from "../hooks/useNow";
import { relativeShort } from "../lib/dates";
import { loadRecent, pushRecent } from "../lib/recent";
import { deviceStore } from "../lib/storage";
import { colors } from "../theme/tokens";

const TRY = ["that cafe reel", "workout for back pain", "repo for job search"];

function TryChips({ onPick }: { onPick: (q: string) => void }) {
  return (
    <View className="mt-6">
      <Text className="font-sans-semibold text-label text-ink-2">TRY</Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {TRY.map((t) => (
          <Chip key={t} label={t} onPress={() => onPick(t)} />
        ))}
      </View>
    </View>
  );
}

function ResultRow({ hit, now, onPress }: { hit: SearchHit; now: number; onPress: () => void }) {
  const s = hit.save;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="flex-row py-3 active:opacity-80">
      <View style={{ width: 64 }}>
        <Thumb uri={s.status === "enriched" ? s.thumbnail_url : null} aspect={64 / 80} radius={10} />
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-start">
          <Text numberOfLines={2} className="flex-1 font-sans-semibold text-title text-ink">
            {cardTitle(s)}
          </Text>
          <Text className="ml-2 font-sans text-meta text-ink-3">{relativeShort(s.created_at, now)}</Text>
        </View>
        <View className="mt-2 flex-row flex-wrap gap-1.5">
          {hit.why.map((w) => (
            <View key={w} className="rounded-full bg-raised px-2 py-1">
              <Text numberOfLines={1} className="font-sans text-caption text-ink-2">
                {w}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

export function SearchScreen() {
  const { q: initial = "" } = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [query, setQuery] = useState(initial);
  const [debounced, setDebounced] = useState(initial.trim());
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    loadRecent(deviceStore).then(setRecent);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 0,
  });

  const remember = async (q: string) => setRecent(await pushRecent(deviceStore, q));
  const pick = (q: string) => setQuery(q);
  const hits = results.data ?? [];
  const blank = query.trim().length === 0;

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center border-b border-hairline px-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-12 w-12 items-center justify-center">
          <Icon name="arrow-back" size={24} color={colors.ink} />
        </Pressable>
        <View className="mr-2 h-11 flex-1 flex-row items-center rounded-xl border border-accent bg-card px-3">
          <Icon name="search" size={20} color={colors.ink2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => remember(query)}
            placeholder="Search what you remember…"
            placeholderTextColor={colors.ink3}
            autoFocus
            returnKeyType="search"
            className="ml-2 h-full flex-1 font-sans text-body text-ink"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQuery("")} className="h-10 w-8 items-center justify-center">
              <Icon name="close" size={18} color={colors.ink3} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {blank ? (
        <View className="w-full max-w-[640px] self-center px-4 pt-5">
          {recent.length ? (
            <View>
              <Text className="font-sans-semibold text-label text-ink-2">Recent</Text>
              {recent.map((r) => (
                <Pressable key={r} accessibilityRole="button" onPress={() => pick(r)} className="h-12 flex-row items-center">
                  <Icon name="history" size={20} color={colors.ink3} />
                  <Text className="ml-3 font-sans text-body text-ink">{r}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View>
              <Text className="font-sans-semibold text-label text-ink-2">Recent</Text>
              <Text className="mt-2 font-sans text-meta text-ink-3">Your recent searches show up here.</Text>
            </View>
          )}
          <TryChips onPick={pick} />
        </View>
      ) : results.isLoading || debounced !== query.trim() ? (
        <ActivityIndicator className="mt-12" color={colors.accent} />
      ) : hits.length === 0 ? (
        <View className="w-full max-w-[640px] self-center px-4 pt-10">
          <Text className="font-display text-display-md text-ink">{`Nothing for “${query.trim()}” yet`}</Text>
          <Text className="mt-2 font-sans text-body text-ink-2">
            {"Try a word from your note, a place, or the creator's name."}
          </Text>
          <TryChips onPick={pick} />
        </View>
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.save.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, maxWidth: 640, width: "100%", alignSelf: "center" }}
          ListHeaderComponent={
            <Text className="pt-4 font-sans text-meta text-ink-2">{hits.length === 1 ? "1 reel" : `${hits.length} reels`}</Text>
          }
          ItemSeparatorComponent={() => <View className="h-px bg-hairline" />}
          renderItem={({ item }) => (
            <ResultRow
              hit={item}
              now={now}
              onPress={() => {
                remember(query);
                router.push(`/reel/${item.save.id}`);
              }}
            />
          )}
        />
      )}
    </View>
  );
}
