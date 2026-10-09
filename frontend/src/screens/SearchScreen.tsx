import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SearchHit } from "../api/contract";
import { useApi } from "../api/index";
import { Chip } from "../components/Chip";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { cardTitle } from "../components/ReelCard";
import { SkeletonGroup, SkeletonRow } from "../components/Skeleton";
import { TextField } from "../components/TextField";
import { Thumb } from "../components/Thumb";
import { useNow } from "../hooks/useNow";
import { relativeShort } from "../lib/dates";
import { loadRecent, pushRecent } from "../lib/recent";
import { deviceStore } from "../lib/storage";
import { DURATION } from "../theme/motion";
import { colors } from "../theme/tokens";
import { goBack } from "../lib/navigation";
import { ErrorState } from "../components/ErrorState";
import { pollWhilePending } from "../hooks/useSaves";

const TRY = ["that cafe reel", "workout for back pain", "repo for job search"];

// The screen fades up and the field's focus ring blooms: it reads as the Library's search bar
// opening up. (No entering animation on the field itself: it must be focusable on mount.)
const CLEAR_IN = FadeIn.duration(DURATION.state);
const CLEAR_OUT = FadeOut.duration(120);

function TryChips({ onPick, start = 0 }: { onPick: (q: string) => void; start?: number }) {
  return (
    <Reveal index={start} style={{ marginTop: 24 }}>
      <Text className="font-sans-semibold text-label text-ink-2">TRY</Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {TRY.map((t) => (
          <Chip key={t} label={t} onPress={() => onPick(t)} />
        ))}
      </View>
    </Reveal>
  );
}

function ResultRow({ hit, now, onPress }: { hit: SearchHit; now: number; onPress: () => void }) {
  const s = hit.save;
  return (
    <PressableScale
      accessibilityRole="button"
      onPress={onPress}
      scaleTo={1}
      highlightColor={colors.raised}
      className="-mx-2 flex-row rounded-xl px-2 py-3"
    >
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
    </PressableScale>
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
    refetchInterval: (q) => pollWhilePending(q.state.data?.map((h) => h.save)),
  });

  const remember = useCallback(async (q: string) => setRecent(await pushRecent(deviceStore, q)), []);
  const pick = (q: string) => setQuery(q);
  const hits = results.data ?? [];
  const blank = query.trim().length === 0;
  const searching = results.isLoading || debounced !== query.trim();
  // Each new set of results staggers in; rows scrolled into view later just appear.
  const entrance = useEntranceWindow(debounced, !searching);

  const renderItem = useCallback(
    ({ item, index }: { item: SearchHit; index: number }) => (
      <Reveal index={index} enabled={entrance}>
        <ResultRow
          hit={item}
          now={now}
          onPress={() => {
            remember(query);
            router.push(`/reel/${item.save.id}`);
          }}
        />
      </Reveal>
    ),
    [entrance, now, query, remember, router],
  );

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center border-b border-hairline px-2">
        <IconButton
          icon="arrow-back"
          size={24}
          color={colors.ink}
          label="Back"
          onPress={() => goBack(router)}
        />
        <View style={{ flex: 1, marginRight: 8 }}>
          <TextField
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => remember(query)}
            placeholder="Search what you remember…"
            autoFocus
            returnKeyType="search"
            tone="card"
            inputClassName="ml-2 -mr-1"
            leading={<Icon name="search" size={20} color={colors.ink2} />}
            trailing={
              query ? (
                <Animated.View entering={CLEAR_IN} exiting={CLEAR_OUT} style={{ marginRight: -12 }}>
                  <IconButton icon="close" size={18} color={colors.ink3} label="Clear" onPress={() => setQuery("")} />
                </Animated.View>
              ) : null
            }
          />
        </View>
      </View>

      {blank ? (
        <View className="w-full max-w-[640px] self-center px-4 pt-5">
          {recent.length ? (
            <View>
              <Reveal index={0}>
                <Text className="font-sans-semibold text-label text-ink-2">Recent</Text>
              </Reveal>
              {recent.map((r, i) => (
                <Reveal key={r} index={i + 1}>
                  <PressableScale
                    accessibilityRole="button"
                    onPress={() => pick(r)}
                    scaleTo={1}
                    highlightColor={colors.raised}
                    className="-mx-2 h-12 flex-row items-center rounded-xl px-2"
                  >
                    <Icon name="history" size={20} color={colors.ink3} />
                    <Text className="ml-3 font-sans text-body text-ink">{r}</Text>
                  </PressableScale>
                </Reveal>
              ))}
            </View>
          ) : (
            <Reveal index={0}>
              <Text className="font-sans-semibold text-label text-ink-2">Recent</Text>
              <Text className="mt-2 font-sans text-meta text-ink-3">Your recent searches show up here.</Text>
            </Reveal>
          )}
          <TryChips onPick={pick} start={Math.min(recent.length + 1, 6)} />
        </View>
      ) : searching ? (
        <SkeletonGroup style={{ paddingHorizontal: 16, paddingTop: 36, maxWidth: 640, width: "100%", alignSelf: "center" }}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </SkeletonGroup>
      ) : results.isError && !results.data ? (
        <ErrorState title="Couldn't search right now" onRetry={() => results.refetch()} retrying={results.isRefetching} />
      ) : hits.length === 0 ? (
        <View className="w-full max-w-[640px] self-center px-4 pt-10">
          <Reveal index={0}>
            <Text className="font-display text-display-md text-ink">{`Nothing for “${query.trim()}” yet`}</Text>
            <Text className="mt-2 font-sans text-body text-ink-2">
              {"Try a word from your note, a place, or the creator's name."}
            </Text>
          </Reveal>
          <TryChips onPick={pick} start={1} />
        </View>
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => `${debounced}:${h.save.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, maxWidth: 640, width: "100%", alignSelf: "center" }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text className="pt-4 font-sans text-meta text-ink-2">{hits.length === 1 ? "1 reel" : `${hits.length} reels`}</Text>
          }
          ItemSeparatorComponent={Separator}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

function Separator() {
  return <View className="h-px bg-hairline" />;
}
