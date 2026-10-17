import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, type Save, type SaveDetail } from "../api/contract";
import { useApi } from "../api/index";
import { Button } from "../components/Button";
import { CategoryDot } from "../components/CategoryDot";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NoteBlock } from "../components/detail/NoteBlock";
import { PlaceCard } from "../components/detail/PlaceCard";
import { ProgressTracker } from "../components/detail/ProgressTracker";
import { StackPicker } from "../components/detail/StackPicker";
import { HEADER_HEIGHT, LOGO, ScrollHairline } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { usePop } from "../components/motion/feedback";
import { cardTitle } from "../components/ReelCard";
import { Sheet } from "../components/Sheet";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { Thumb } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { useNow } from "../hooks/useNow";
import { isStalePending, markRetried, pollWhilePending } from "../hooks/useSaves";
import { useReadingStyle } from "../hooks/usePreferences";
import { savedAgo } from "../lib/dates";
import { haptic } from "../lib/haptics";
import { displayLink } from "../lib/instagram";
import { shareOrCopy } from "../lib/share";
import { DURATION, EASE_IN_OUT, EASE_OUT } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { goBack } from "../lib/navigation";
import { refreshSaveViews } from "../lib/queryClient";

const CHANNEL = { app_share: "Share", web: "Web", meta_dm: "DM" } as const;

// Expanding the caption: the text dissolves in and everything below glides down to make room.
const CAPTION_IN = FadeIn.duration(DURATION.enter).easing(EASE_OUT);
const CAPTION_OUT = FadeOut.duration(DURATION.exit);
const REFLOW = LinearTransition.duration(240).easing(EASE_OUT);

function Label({ children }: { children: string }) {
  return <Text className="font-sans-semibold text-label text-ink">{children}</Text>;
}

/** Hero media shape: a little shorter than 4:5 so the title shows on the first screen. */
const HERO_ASPECT = 9 / 10;

/** Content column: full width minus 16 pt sides, at most 560 wide (tablets, web). */
const COLUMN_MAX = 560;

/**
 * Back on the left, the card's actions on the right. Once the hero and title scroll away the
 * title fades into the bar, so the reader always knows which card this is.
 */
function TopBar({
  onBack,
  title,
  titleFrom,
  scrollY,
  children,
}: {
  onBack: () => void;
  title?: string;
  /** Scroll offset at which the page title has slid under the bar. */
  titleFrom: number;
  scrollY: SharedValue<number>;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const titleStyle = useAnimatedStyle(() => {
    const p = interpolate(scrollY.get(), [titleFrom, titleFrom + 40], [0, 1], Extrapolation.CLAMP);
    return { opacity: p, transform: [{ translateY: 6 * (1 - p) }] };
  });
  return (
    <View className="flex-row items-center bg-canvas px-1" style={{ height: HEADER_HEIGHT }}>
      <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={onBack} />
      <Animated.Text
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="mx-1 flex-1 font-sans-semibold text-body text-ink"
        style={titleStyle}
      >
        {title ?? ""}
      </Animated.Text>
      {children}
      <ScrollHairline scrollY={scrollY} />
    </View>
  );
}

function Overlay({ icon, text, className }: { icon: IconName; text: string; className: string }) {
  const { colors } = useTheme();
  return (
    <View className={`absolute flex-row items-center rounded-full px-2.5 py-1 ${className}`} style={{ backgroundColor: colors.scrim }}>
      <Icon name={icon} size={14} color={colors.onMedia} />
      <Text className="ml-1 font-sans-semibold text-caption text-on-media">{text}</Text>
    </View>
  );
}

/**
 * The hero sits in a window: as the page scrolls the image drifts slower than its frame, and an
 * iOS pull-down stretches it. Both read the scroll offset on the UI thread.
 */
function useHeroParallax(scrollY: SharedValue<number>) {
  const reduced = useReducedMotion();
  return useAnimatedStyle(() => {
    if (reduced) return {};
    const y = scrollY.get();
    return {
      transform: [
        { translateY: interpolate(y, [-200, 0, 400], [-40, 0, 36], Extrapolation.CLAMP) },
        { scale: interpolate(y, [-200, 0], [1.25, 1.06], Extrapolation.CLAMP) },
      ],
    };
  });
}

function Hero({ card, mediaStyle }: { card: Save; mediaStyle?: ReturnType<typeof useHeroParallax> }) {
  const { colors } = useTheme();
  const openIg = (
    <PressableScale
      accessibilityRole="link"
      onPress={() => Linking.openURL(card.source_url)}
      scaleTo={0.95}
      containerClassName="absolute bottom-3 left-3"
      className="h-10 flex-row items-center rounded-full border px-4"
      style={{ backgroundColor: colors.scrim, borderColor: colors.mediaHairline }}
    >
      <Text className="font-sans-semibold text-meta text-on-media">Open in Instagram</Text>
      <Icon name="north-east" size={16} color={colors.onMedia} />
    </PressableScale>
  );
  if (card.status === "pending") {
    return (
      <Thumb uri={null} aspect={HERO_ASPECT} className="border border-hairline">
        <Skeleton style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
        <View className="flex-1 items-center justify-center">
          <Icon name="movie" size={40} color={colors.ink3} />
          <Text className="mt-2 font-sans-medium text-body text-ink-2">Getting details…</Text>
        </View>
        {openIg}
      </Thumb>
    );
  }
  if (card.status === "partial" || !card.thumbnail_url) {
    return (
      <Thumb uri={null} aspect={HERO_ASPECT} className="border border-hairline">
        <View className="flex-1 items-center justify-center bg-raised">
          <Icon name="image-not-supported" size={40} color={colors.ink3} />
          <Text className="mt-2 font-sans-medium text-body text-ink-2">Preview unavailable</Text>
        </View>
        {openIg}
      </Thumb>
    );
  }
  return (
    <Thumb uri={card.thumbnail_url} aspect={HERO_ASPECT} mediaStyle={mediaStyle} className="border border-hairline">
      <Overlay icon="smart-display" text="Reel" className="right-3 top-3" />
      {openIg}
    </Thumb>
  );
}

/** The card as the Library last saw it, so the hero is in place while the detail loads. */
function useCachedSave(id: string): Save | undefined {
  const queryClient = useQueryClient();
  return useMemo(
    () =>
      queryClient
        .getQueriesData<InfiniteData<Save[]>>({ queryKey: ["saves"] })
        .flatMap(([, data]) => data?.pages.flat() ?? [])
        .find((s) => s.id === id),
    [queryClient, id],
  );
}

function CaptionToggle({ open, onPress }: { open: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: 220, easing: EASE_IN_OUT }));
  }, [open, turn]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return (
    <PressableScale
      accessibilityRole="button"
      onPress={onPress}
      scaleTo={1}
      highlightColor={colors.raised}
      className="-mx-2 h-14 flex-row items-center rounded-xl px-2"
    >
      <Icon name="description" size={20} color={colors.ink2} />
      <Text className="ml-3 flex-1 font-sans text-body text-ink-2">Original caption</Text>
      <Animated.View style={chevron}>
        <Icon name="expand-more" size={22} color={colors.ink2} />
      </Animated.View>
    </PressableScale>
  );
}

export function CardDetailScreen() {
  const { colors } = useTheme();
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const readingStyle = useReadingStyle();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const bookmark = usePop();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });
  const parallax = useHeroParallax(scrollY);
  // The page title sits under the hero (creator row above it); once its last line passes the
  // bar, the bar shows it. Two lines of display type ≈ 64 pt.
  const { width } = useWindowDimensions();
  const heroHeight = (Math.min(width, COLUMN_MAX) - 32) / HERO_ASPECT;
  const titleFrom = heroHeight + 4 + 12 + 18 + 4 + 40;

  const query = useQuery({
    queryKey: ["save", id],
    queryFn: () => api.getSave(id),
    retry: (count, e) => !(e instanceof ApiError && e.code === "NOT_FOUND") && count < 2,
    refetchInterval: (q) => pollWhilePending(q.state.data ? [q.state.data] : undefined),
  });
  const card = query.data;
  const preview = useCachedSave(id);
  const back = () => goBack(router);

  async function share() {
    if (!card) return;
    const how = await shareOrCopy({ title: card.title ?? displayLink(card.source_url), url: card.source_url });
    if (how === "copied") toast.show("Link copied");
  }

  async function saveNote(note: string) {
    const updated = await api.setNote(id, note);
    queryClient.setQueryData<SaveDetail>(["save", id], (old) => (old ? { ...old, note: updated.note } : old));
    queryClient.invalidateQueries({ queryKey: ["saves"] });
    queryClient.invalidateQueries({ queryKey: ["search"] });
    queryClient.invalidateQueries({ queryKey: ["stack"] });
    queryClient.invalidateQueries({ queryKey: ["curated"] });
  }

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await api.retryEnrichment(id);
      markRetried(id);
      haptic.success();
      // Back to processing: the detail polls until the new card is ready.
      queryClient.setQueryData<SaveDetail>(["save", id], (old) =>
        old ? { ...old, status: "pending", media_status: "pending" } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["saves"] });
      queryClient.invalidateQueries({ queryKey: ["stack"] });
    } catch {
      haptic.error();
      toast.show("Couldn't retry. Try again later.");
    } finally {
      setRetrying(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.deleteSave(id);
      haptic.medium();
      queryClient.removeQueries({ queryKey: ["save", id], exact: true });
      refreshSaveViews(queryClient);
      setConfirmOpen(false);
      toast.show("Deleted");
      back();
    } catch {
      haptic.error();
      toast.show("Couldn't delete. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  let body: ReactNode;
  if (query.isLoading) {
    body = (
      <View className="w-full max-w-[560px] self-center px-4 pb-10">
        <View className="h-12" />
        {preview ? (
          <Link.AppleZoomTarget>
            <View>
              <Hero card={preview} mediaStyle={parallax} />
            </View>
          </Link.AppleZoomTarget>
        ) : (
          <Skeleton style={{ aspectRatio: HERO_ASPECT, borderRadius: 14 }} />
        )}
        <SkeletonGroup>
          {preview ? (
            <Text className="mt-6 font-display text-display-lg text-ink">{cardTitle(preview)}</Text>
          ) : (
            <Skeleton style={{ marginTop: 24, height: 28, width: "80%", borderRadius: 8 }} />
          )}
          <Skeleton style={{ marginTop: 16, height: 32, width: 160, borderRadius: 999 }} />
          <Skeleton style={{ marginTop: 28, height: 96, borderRadius: 16 }} />
          <Skeleton style={{ marginTop: 24, height: 14, width: "92%", borderRadius: 7 }} />
          <Skeleton style={{ marginTop: 8, height: 14, width: "76%", borderRadius: 7 }} />
        </SkeletonGroup>
      </View>
    );
  } else if (!card) {
    const gone = query.error instanceof ApiError && query.error.code === "NOT_FOUND";
    body = (
      <Reveal>
        <View className="items-center px-6 pt-16">
          <Icon name={gone ? "search-off" : "cloud-off"} size={40} color={colors.ink3} />
          <Text className="mt-4 text-center font-display text-display-md text-ink">
            {gone ? "This card isn't here anymore" : "Couldn't load this card"}
          </Text>
          <Button title="Back to Library" variant="secondary" onPress={() => router.replace("/")} className="mt-6 w-full max-w-[320px]" />
        </View>
      </Reveal>
    );
  } else {
    const status =
      card.status === "pending"
        ? { text: "GETTING DETAILS", color: colors.accent }
        : card.status === "partial"
          ? { text: "PREVIEW UNAVAILABLE", color: colors.ink3 }
          : null;
    const title = card.title ?? (card.status === "pending" ? displayLink(card.source_url) : card.caption?.split("\n")[0] ?? displayLink(card.source_url));
    const showCaption = card.status === "partial" || captionOpen;
    const stale = isStalePending(card, now);
    // The hero sits at the same place in the tree while loading and once loaded, so it stays
    // mounted (the zoom lands on it, the image never re-fades); the text below it arrives in turn.
    let i = 0;
    const next = () => i++;

    body = (
      <View className="w-full max-w-[560px] self-center px-4 pb-10 pt-1">
        <Link.AppleZoomTarget>
          <View>
            <Hero card={card} mediaStyle={parallax} />
          </View>
        </Link.AppleZoomTarget>

        <Reveal index={next()}>
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="font-sans text-meta text-ink-2">
              {card.creator ? `@${card.creator}` : displayLink(card.source_url)}
            </Text>
            <Text className="font-sans text-caption text-ink-3">Instagram</Text>
          </View>
          <Text className="mt-1 font-display text-display-lg text-ink">{title}</Text>
          <View className="mt-3 flex-row items-center">
            {card.category ? (
              <View className="mr-2 h-8 flex-row items-center rounded-full border border-hairline bg-raised px-3">
                <CategoryDot category={card.category} />
                <Text className="ml-1.5 font-sans-medium text-meta text-ink">{card.category}</Text>
              </View>
            ) : null}
            <Text className="font-sans text-meta text-ink-2">{savedAgo(card.created_at, now)}</Text>
            {status ? (
              <View className="ml-3 flex-row items-center">
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                <Text className="ml-1.5 font-sans-semibold text-label text-ink-2">{status.text}</Text>
              </View>
            ) : null}
          </View>
        </Reveal>

        <Reveal index={next()}>
          <View className="my-4 h-px bg-hairline" />
          <NoteBlock
            note={card.note}
            onSave={saveNote}
            textStyle={{ fontSize: readingStyle.fontSize, lineHeight: readingStyle.lineHeight }}
          />
        </Reveal>

        {card.status === "partial" || stale ? (
          <Reveal index={next()} style={{ marginTop: 16 }}>
            <Text className="font-sans text-meta text-ink-2">
              {stale
                ? "This is taking longer than usual. Lately can try again."
                : "Lately couldn't read this reel's video. It can try again."}
            </Text>
            <Button
              title="Try getting details again"
              variant="secondary"
              icon="refresh"
              onPress={retry}
              loading={retrying}
              className="mt-3"
            />
          </Reveal>
        ) : null}

        {card.status === "pending" ? (
          <Reveal index={next()} style={{ marginTop: 20 }}>
            <ProgressTracker current={1} />
          </Reveal>
        ) : null}

        {card.summary ? (
          <Reveal index={next()} style={{ marginTop: 24 }}>
            <Label>SUMMARY</Label>
            <Text className="mt-2 font-sans text-body text-ink" style={readingStyle}>
              {card.summary}
            </Text>
          </Reveal>
        ) : null}

        {card.steps?.length ? (
          <Reveal index={next()} style={{ marginTop: 24 }}>
            <Label>GOOD TO KNOW</Label>
            {card.steps.map((step) => (
              <View key={step} className="mt-3 flex-row items-center">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-raised">
                  <Icon name="check" size={16} color={colors.accent} />
                </View>
                <Text className="ml-3 flex-1 font-sans text-body text-ink">{step}</Text>
              </View>
            ))}
          </Reveal>
        ) : null}

        {card.places.length ? (
          <Reveal index={next()} style={{ marginTop: 24, gap: 12 }}>
            {card.places.map((p) => (
              <PlaceCard key={p.name} place={p} />
            ))}
          </Reveal>
        ) : null}

        {card.tags?.length ? (
          <Reveal index={next()} style={{ marginTop: 24 }}>
            <View className="flex-row flex-wrap gap-2">
              {card.tags.map((t) => (
                <View key={t} className="h-9 justify-center rounded-full border border-hairline bg-raised px-3">
                  <Text className="font-sans text-body text-ink-2">{`#${t}`}</Text>
                </View>
              ))}
            </View>
          </Reveal>
        ) : null}

        {card.caption ? (
          <Reveal index={next()}>
            <View className="mt-6 border-t border-hairline">
              <CaptionToggle open={showCaption} onPress={() => setCaptionOpen((o) => !o)} />
              {showCaption ? (
                <Animated.View entering={card.status === "partial" ? undefined : CAPTION_IN} exiting={CAPTION_OUT}>
                  <Text className="pb-4 font-sans text-body text-ink" style={readingStyle}>
                    {card.caption}
                  </Text>
                </Animated.View>
              ) : null}
            </View>
          </Reveal>
        ) : null}

        <Animated.View layout={REFLOW}>
          <Reveal index={next()}>
            <View className="mt-2 flex-row items-center border-t border-hairline pt-5">
              <Image source={LOGO} style={{ width: 20, height: 20, borderRadius: 5 }} />
              <Text className="ml-2 flex-1 font-sans text-meta text-ink-2">
                Saved to <Text className="font-sans-semibold text-ink">Lately</Text> via {CHANNEL[card.channel]}
              </Text>
              <PressableScale
                accessibilityRole="button"
                onPress={share}
                scaleTo={0.95}
                highlightColor={colors.raised}
                className="h-10 flex-row items-center rounded-full border border-hairline bg-card px-4"
              >
                <Icon name="ios-share" size={16} color={colors.ink} />
                <Text className="ml-1.5 font-sans-semibold text-meta text-ink">Export</Text>
              </PressableScale>
            </View>
          </Reveal>
        </Animated.View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <TopBar onBack={back} title={card ? cardTitle(card) : undefined} titleFrom={titleFrom} scrollY={scrollY}>
        {card ? (
          <>
            <IconButton icon="share" label="Share" onPress={share} />
            <IconButton label="Add to stack" onPress={() => setPickerOpen(true)}>
              <Animated.View style={bookmark.style}>
                <Icon name="bookmark" size={22} color={colors.accent} />
              </Animated.View>
            </IconButton>
            <IconButton icon="more-vert" label="More" onPress={() => setMenuOpen(true)} />
          </>
        ) : null}
      </TopBar>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {body}
      </Animated.ScrollView>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        {card ? (
          <View className="pb-2">
            <PressableScale
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                Linking.openURL(card.source_url);
              }}
              scaleTo={1}
              highlightColor={colors.raised}
              className="-mx-2 h-12 flex-row items-center rounded-xl px-2"
            >
              <Icon name="open-in-new" size={22} color={colors.ink} />
              <Text className="ml-3 font-sans-medium text-body text-ink">Open in Instagram</Text>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
              scaleTo={1}
              highlightColor={colors.dangerSoft}
              className="-mx-2 h-12 flex-row items-center rounded-xl px-2"
            >
              <Icon name="delete-outline" size={22} color={colors.danger} />
              <Text className="ml-3 font-sans-medium text-body text-danger">Delete</Text>
            </PressableScale>
          </View>
        ) : null}
      </Sheet>

      <StackPicker
        visible={pickerOpen}
        saveId={id}
        onClose={() => setPickerOpen(false)}
        onAdded={() => bookmark.pop(DURATION.sheet)}
      />

      <ConfirmDialog
        visible={confirmOpen}
        title="Delete this reel?"
        message="It will be removed from your Lately."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}
