import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CuratedSection, Save } from "../api/contract";
import { useApi } from "../api/index";
import { Header } from "../components/Header";
import { sentence } from "../components/home/BackForYou";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { ReelCard, ZoomLink, cardTitle } from "../components/ReelCard";
import { Skeleton, SkeletonGroup, SkeletonRow } from "../components/Skeleton";
import { Thumb } from "../components/Thumb";
import { useNow } from "../hooks/useNow";
import { pollWhilePending, useMe } from "../hooks/useSaves";
import { relativeShort } from "../lib/dates";
import { haptic } from "../lib/haptics";
import { goBack } from "../lib/navigation";
import { useTheme } from "../theme/ThemeProvider";
import { ErrorState } from "../components/ErrorState";

/** Width of a card in a horizontal row: narrow enough that the next one peeks in. */
const ROW_CARD = 136;
/** The hero picture: a wide 16:9 band, not half the screen. */
const HERO_ASPECT = 16 / 9;
/** The column the page sits in; the header above it uses the same width. */
const CONTENT_WIDTH = 720;
/** Space between the blocks of the page (the hero and each section). */
const SECTION_GAP = 24;
/** Media radius by role: 12 for tiles and thumbs, 16 for this hero (like the search best match). */
const HERO_RADIUS = 16;

function ListRow({ save, now }: { save: Save; now: number }) {
  const { colors } = useTheme();
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
            <Thumb uri={save.status === "enriched" ? save.thumbnail_url : null} aspect={64 / 80} radius={12} />
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
    <Reveal index={index} style={{ marginTop: SECTION_GAP }}>
      <Text accessibilityRole="header" className="px-4 font-display text-display-sm text-ink">
        {section.title}
      </Text>
      {section.subtitle ? <Text className="mt-0.5 px-4 font-sans text-meta text-ink-2">{section.subtitle}</Text> : null}
      {section.kind === "row" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={ROW_CARD + 12}
          snapToAlignment="start"
          className="mt-3"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {section.saves.map((s) => (
            <View key={s.id} style={{ width: ROW_CARD }}>
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

/**
 * Picks resurfaced from your own saves (Home's "Back for you" > See all): one hero pick, then
 * rows and lists. Its sections are whatever the feed sends (it shapes them server-side).
 */
export function CuratedScreen() {
  const { colors } = useTheme();
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
        // Curated is a stack screen now (Home's "See all"), no longer a tab.
        onBack={() => goBack(router)}
        scrollY={scrollY}
        maxWidth={CONTENT_WIDTH}
      />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => {
              haptic.light();
              feed.refetch();
            }}
            tintColor={colors.accentText}
            colors={[colors.accentText]}
            progressBackgroundColor={colors.card}
          />
        }
      >
        <View className="w-full self-center" style={{ maxWidth: CONTENT_WIDTH }}>
          <View className="px-4 pt-3">
            <Text accessibilityRole="header" className="font-display text-display-lg text-ink">
              Back for you
            </Text>
            {feed.data ? (
              <Reveal>
                <Text className="mt-0.5 font-sans text-meta text-ink-2">{`${feed.data.date_label} · picked from your saves`}</Text>
              </Reveal>
            ) : null}
          </View>

          {feed.isLoading ? (
            <SkeletonGroup style={{ paddingHorizontal: 16, marginTop: SECTION_GAP }}>
              <Skeleton style={{ height: 12, width: 110, borderRadius: 6 }} />
              <Skeleton style={{ marginTop: 12, aspectRatio: HERO_ASPECT, borderRadius: HERO_RADIUS }} />
              <Skeleton style={{ marginTop: 12, height: 22, width: "70%", borderRadius: 8 }} />
              <Skeleton style={{ marginTop: 8, height: 12, width: "45%", borderRadius: 6 }} />
              <View className="mt-6">
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
              icon="history"
              title="Nothing to resurface yet"
              body="Save a few reels and Lately will bring back ones you haven't looked at in a while."
            />
          ) : null}

          {hero && hero.save_ids.length > 0 ? (
            <Reveal index={1} style={{ marginTop: SECTION_GAP, paddingHorizontal: 16 }}>
              {/* The feed's label is shouted ("THIS WEEK"); here it reads as a sentence, like Home's tiles. */}
              <Text className="font-sans-semibold text-meta text-ink-2">{sentence(hero.label)}</Text>
              <ZoomLink href={`/reel/${hero.save_ids[0]}`}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={hero.title}
                  scaleTo={0.98}
                  containerClassName="mt-3"
                >
                  <Link.AppleZoom>
                    <Thumb uri={hero.image_url} aspect={HERO_ASPECT} radius={HERO_RADIUS} className="border border-hairline" />
                  </Link.AppleZoom>
                </PressableScale>
              </ZoomLink>
              <Text className="mt-3 font-display text-display-md text-ink">{hero.title}</Text>
              <Text className="mt-1 font-sans text-meta text-ink-2">{hero.subtitle}</Text>
              <PressableScale
                accessibilityRole="button"
                onPress={() => router.push(`/search?q=${encodeURIComponent(hero.query)}`)}
                scaleTo={0.96}
                containerClassName="mt-2 self-start"
                className="h-10 justify-center"
              >
                <Text className="font-sans-semibold text-body text-ink">{`See all ${hero.save_ids.length}`}</Text>
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
