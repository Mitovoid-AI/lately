import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CuratedSection, Save } from "../api/contract";
import { useApi } from "../api/index";
import { Header } from "../components/Header";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { ReelCard, ZoomLink, cardTitle } from "../components/ReelCard";
import { Skeleton, SkeletonGroup, SkeletonRow } from "../components/Skeleton";
import { Thumb } from "../components/Thumb";
import { useNow } from "../hooks/useNow";
import { pollWhilePending, useMe } from "../hooks/useSaves";
import { relativeShort } from "../lib/dates";
import { haptic } from "../lib/haptics";
import { colors } from "../theme/tokens";
import { ErrorState } from "../components/ErrorState";

function ListRow({ save, now }: { save: Save; now: number }) {
  return (
    <ZoomLink href={`/reel/${save.id}`}>
      <PressableScale
        accessibilityRole="button"
        scaleTo={1}
        highlightColor={colors.raised}
        className="-mx-2 flex-row items-center rounded-xl px-2 py-3"
      >
        <View style={{ width: 64 }}>
          <Link.AppleZoom>
            <Thumb uri={save.status === "enriched" ? save.thumbnail_url : null} aspect={64 / 80} radius={10} />
          </Link.AppleZoom>
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
      </PressableScale>
    </ZoomLink>
  );
}

function Section({ section, now, index }: { section: CuratedSection; now: number; index: number }) {
  if (section.saves.length === 0) return null;
  return (
    <Reveal index={index} style={{ marginTop: 32 }}>
      <Text className="px-4 font-display text-ink" style={{ fontSize: 20, lineHeight: 26 }}>
        {section.title}
      </Text>
      {section.subtitle ? <Text className="mt-0.5 px-4 font-sans text-meta text-ink-2">{section.subtitle}</Text> : null}
      {section.kind === "row" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={162}
          snapToAlignment="start"
          className="mt-3"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {section.saves.map((s) => (
            <View key={s.id} style={{ width: 150 }}>
              <ReelCard save={s} now={now} href={`/reel/${s.id}`} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <View className="mt-1 px-4">
          {section.saves.map((s, i) => (
            <View key={s.id} className={i > 0 ? "border-t border-hairline" : ""}>
              <ListRow save={s} now={now} />
            </View>
          ))}
        </View>
      )}
    </Reveal>
  );
}

/** Built to the "06 Curated — light" generation brief: picks resurfaced from your own saves. */
export function CuratedScreen() {
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const me = useMe().data;
  const feed = useQuery({
    queryKey: ["curated"],
    queryFn: () => api.getCurated(),
    refetchInterval: (q) => pollWhilePending(q.state.data?.sections.flatMap((s) => s.saves)),
  });
  const hero = feed.data?.hero;
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <Header
        avatarUrl={me?.avatar_url}
        initial={me?.name?.[0]}
        onAvatar={() => router.push("/account")}
        onBookmark={() => router.push("/stacks")}
        scrollY={scrollY}
      />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => {
              haptic.light();
              feed.refetch();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        }
      >
        <View className="w-full max-w-[720px] self-center">
          <View className="px-4 pt-5">
            <Text className="font-display-regular text-ink" style={{ fontSize: 32, lineHeight: 38 }}>
              Curated for you
            </Text>
            {feed.data ? (
              <Reveal>
                <Text className="mt-1 font-sans text-body text-ink-2">{`${feed.data.date_label} · picked from your saves`}</Text>
              </Reveal>
            ) : null}
          </View>

          {feed.isLoading ? (
            <SkeletonGroup style={{ paddingHorizontal: 16, marginTop: 24 }}>
              <Skeleton style={{ height: 12, width: 110, borderRadius: 6 }} />
              <Skeleton style={{ marginTop: 12, aspectRatio: 16 / 11, borderRadius: 14 }} />
              <Skeleton style={{ marginTop: 12, height: 22, width: "70%", borderRadius: 8 }} />
              <Skeleton style={{ marginTop: 8, height: 12, width: "45%", borderRadius: 6 }} />
              <View className="mt-8">
                <SkeletonRow />
                <SkeletonRow />
              </View>
            </SkeletonGroup>
          ) : null}

          {feed.isError && !feed.data ? (
            <ErrorState title="Couldn't load your picks" onRetry={() => feed.refetch()} retrying={feed.isRefetching} />
          ) : null}

          {feed.data && !hero?.save_ids.length && feed.data.sections.every((s) => s.saves.length === 0) ? (
            <ErrorState
              icon="auto-awesome"
              title="Nothing to resurface yet"
              body="Save a few reels and Lately will bring the best ones back here."
            />
          ) : null}

          {hero && hero.save_ids.length > 0 ? (
            <Reveal index={1} style={{ marginTop: 24, paddingHorizontal: 16 }}>
              <Text className="font-sans-semibold text-label text-ink-2">{hero.label}</Text>
              <ZoomLink href={`/reel/${hero.save_ids[0]}`}>
                <PressableScale accessibilityRole="button" scaleTo={0.98} containerClassName="mt-3">
                  <Link.AppleZoom>
                    <Thumb uri={hero.image_url} aspect={16 / 11} className="border border-hairline" />
                  </Link.AppleZoom>
                </PressableScale>
              </ZoomLink>
              <Text className="mt-3 font-display text-ink" style={{ fontSize: 22, lineHeight: 28 }}>
                {hero.title}
              </Text>
              <Text className="mt-1 font-sans text-meta text-ink-2">{hero.subtitle}</Text>
              <PressableScale
                accessibilityRole="button"
                onPress={() => router.push(`/search?q=${encodeURIComponent(hero.query)}`)}
                scaleTo={0.96}
                containerClassName="mt-2 self-start"
                className="h-10 justify-center"
              >
                <Text className="font-sans-semibold text-body text-accent">{`See all ${hero.save_ids.length}`}</Text>
              </PressableScale>
            </Reveal>
          ) : null}

          {(feed.data?.sections ?? []).map((s, i) => (
            <Section key={s.title} section={s} now={now} index={i + 2} />
          ))}
        </View>
      </Animated.ScrollView>
    </View>
  );
}
