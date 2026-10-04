import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CuratedSection, Save } from "../api/contract";
import { useApi } from "../api/index";
import { Header } from "../components/Header";
import { ReelCard, cardTitle } from "../components/ReelCard";
import { Thumb } from "../components/Thumb";
import { useNow } from "../hooks/useNow";
import { useMe } from "../hooks/useSaves";
import { relativeShort } from "../lib/dates";
import { colors } from "../theme/tokens";

function ListRow({ save, now, onPress }: { save: Save; now: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="flex-row items-center py-3 active:opacity-80">
      <View style={{ width: 64 }}>
        <Thumb uri={save.status === "enriched" ? save.thumbnail_url : null} aspect={64 / 80} radius={10} />
      </View>
      <View className="ml-3 flex-1">
        <Text numberOfLines={2} className="font-sans-semibold text-title text-ink">
          {cardTitle(save)}
        </Text>
        {save.note ? (
          <Text numberOfLines={1} className="mt-1 font-sans-italic text-meta text-ink-2">{`“${save.note}”`}</Text>
        ) : null}
      </View>
      <Text className="ml-3 font-sans text-meta text-ink-3">{relativeShort(save.created_at, now)}</Text>
    </Pressable>
  );
}

function Section({ section, now, open }: { section: CuratedSection; now: number; open: (id: string) => void }) {
  if (section.saves.length === 0) return null;
  return (
    <View className="mt-8">
      <Text className="px-4 font-display text-ink" style={{ fontSize: 20, lineHeight: 26 }}>
        {section.title}
      </Text>
      {section.subtitle ? <Text className="mt-0.5 px-4 font-sans text-meta text-ink-2">{section.subtitle}</Text> : null}
      {section.kind === "row" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
          {section.saves.map((s) => (
            <View key={s.id} style={{ width: 150 }}>
              <ReelCard save={s} now={now} onPress={() => open(s.id)} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <View className="mt-1 px-4">
          {section.saves.map((s, i) => (
            <View key={s.id} className={i > 0 ? "border-t border-hairline" : ""}>
              <ListRow save={s} now={now} onPress={() => open(s.id)} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Built to the "06 Curated — light" generation brief: picks resurfaced from your own saves. */
export function CuratedScreen() {
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const me = useMe().data;
  const feed = useQuery({ queryKey: ["curated"], queryFn: () => api.getCurated() });
  const open = (id: string) => router.push(`/reel/${id}`);
  const hero = feed.data?.hero;

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <Header
        avatarUrl={me?.avatar_url}
        initial={me?.name?.[0]}
        onAvatar={() => router.push("/account")}
        onBookmark={() => router.push("/stacks")}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="w-full max-w-[720px] self-center">
          <View className="px-4 pt-5">
            <Text className="font-display-regular text-ink" style={{ fontSize: 32, lineHeight: 38 }}>
              Curated for you
            </Text>
            {feed.data ? (
              <Text className="mt-1 font-sans text-body text-ink-2">{`${feed.data.date_label} · picked from your saves`}</Text>
            ) : null}
          </View>

          {feed.isLoading ? <ActivityIndicator className="mt-12" color={colors.accent} /> : null}

          {hero && hero.save_ids.length > 0 ? (
            <View className="mt-6 px-4">
              <Text className="font-sans-semibold text-label text-ink-2">{hero.label}</Text>
              <Pressable accessibilityRole="button" onPress={() => open(hero.save_ids[0])} className="mt-3 active:opacity-90">
                <Thumb uri={hero.image_url} aspect={16 / 11} className="border border-hairline" />
              </Pressable>
              <Text className="mt-3 font-display text-ink" style={{ fontSize: 22, lineHeight: 28 }}>
                {hero.title}
              </Text>
              <Text className="mt-1 font-sans text-meta text-ink-2">{hero.subtitle}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/search?q=${encodeURIComponent(hero.query)}`)}
                className="mt-2 h-10 justify-center self-start"
              >
                <Text className="font-sans-semibold text-body text-accent">{`See all ${hero.save_ids.length}`}</Text>
              </Pressable>
            </View>
          ) : null}

          {(feed.data?.sections ?? []).map((s) => (
            <Section key={s.title} section={s} now={now} open={open} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
