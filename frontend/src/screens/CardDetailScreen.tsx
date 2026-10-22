import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedRef,
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
import { CategoryPill } from "../components/Chip";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ActionBar, type PrimaryAction } from "../components/detail/ActionBar";
import { FactChips } from "../components/detail/FactChips";
import { deriveFacts, mapsUrl, stepsBeyondFacts } from "../components/detail/facts";
import { NoteBlock } from "../components/detail/NoteBlock";
import { PlaceCard } from "../components/detail/PlaceCard";
import { StackPicker } from "../components/detail/StackPicker";
import { HEADER_HEIGHT, ScrollHairline } from "../components/Header";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { usePop } from "../components/motion/feedback";
import { cardTitle } from "../components/ReelCard";
import { SaveTracker } from "../components/save/SaveTracker";
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
import { PARTIAL_NOTICE } from "../lib/saveOutcome";
import { shareOrCopy } from "../lib/share";
import { DURATION, EASE_IN_OUT, EASE_OUT } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { goBack } from "../lib/navigation";
import { refreshSaveViews } from "../lib/queryClient";

// Expanding the caption: the text dissolves in.
const CAPTION_IN = FadeIn.duration(DURATION.enter).easing(EASE_OUT);
const CAPTION_OUT = FadeOut.duration(DURATION.exit);

/** A section heading in display type ("Tips", "Places"). */
function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" className="font-display text-display-sm text-ink">
      {children}
    </Text>
  );
}

/**
 * Hero media shape. Square: a vertical reel's frame cropped to the middle, short enough that
 * the title and the fact chips are on the first screen of a 375 x 812 phone.
 */
const HERO_ASPECT = 1;

/** Content column: full width minus 16 pt sides, at most 560 wide (tablets, web). */
const COLUMN_MAX = 560;

/** Hero and best-match media use the larger media radius; tiles and thumbnails use 12. */
const HERO_RADIUS = 16;

/**
 * Back on the left, More on the right. Once the hero and title scroll away the title fades
 * into the bar, so the reader always knows which card this is.
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
      {/* Animated.Text takes no className, so its type and flex come through `style`. */}
      <Animated.Text
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          { flex: 1, marginHorizontal: 4, fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 22, color: colors.ink },
          titleStyle,
        ]}
      >
        {title ?? ""}
      </Animated.Text>
      {children}
      <ScrollHairline scrollY={scrollY} />
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

/**
 * The card's media. `showSource` puts an "Open in Instagram" pill on it; the screen turns it
 * on only when the action bar's main button is something else (Directions), so the same
 * action never appears twice at once.
 */
function Hero({
  card,
  mediaStyle,
  showSource = false,
}: {
  card: Save;
  mediaStyle?: ReturnType<typeof useHeroParallax>;
  showSource?: boolean;
}) {
  const { colors } = useTheme();
  const openIg = showSource ? (
    <PressableScale
      accessibilityRole="link"
      onPress={() => Linking.openURL(card.source_url)}
      scaleTo={0.95}
      containerClassName="absolute bottom-3 left-3"
      className="min-h-11 flex-row items-center rounded-full border px-4 py-2"
      style={{ backgroundColor: colors.scrim, borderColor: colors.mediaHairline }}
    >
      <Text className="font-sans-semibold text-meta text-on-media">Open in Instagram</Text>
      <View className="ml-1.5">
        <Icon name="open-in-new" size={16} color={colors.onMedia} />
      </View>
    </PressableScale>
  ) : null;
  if (card.status === "pending") {
    // No words here: the step tracker under the title says what is happening.
    return (
      <Thumb uri={null} aspect={HERO_ASPECT} radius={HERO_RADIUS} className="border border-hairline">
        <Skeleton style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
        <View className="flex-1 items-center justify-center">
          <Icon name="movie" size={40} color={colors.ink3} />
        </View>
        {openIg}
      </Thumb>
    );
  }
  if (card.status === "partial" || !card.thumbnail_url) {
    return (
      <Thumb uri={null} aspect={HERO_ASPECT} radius={HERO_RADIUS} className="border border-hairline">
        <View className="flex-1 items-center justify-center bg-raised">
          <Icon name="image-not-supported" size={40} color={colors.ink3} />
          <Text className="mt-2 font-sans-medium text-body text-ink-2">Preview unavailable</Text>
        </View>
        {openIg}
      </Thumb>
    );
  }
  return (
    <Thumb
      uri={card.thumbnail_url}
      aspect={HERO_ASPECT}
      radius={HERO_RADIUS}
      mediaStyle={mediaStyle}
      className="border border-hairline"
    >
      {openIg}
    </Thumb>
  );
}

/** The card as Home last saw it, so the hero is in place while the detail loads. */
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
      accessibilityLabel="Original caption"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      scaleTo={1}
      highlightColor={colors.raised}
      className="-mx-2 min-h-14 flex-row items-center rounded-xl px-2 py-2"
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
  // While the note editor is open the keyboard needs the room, so the action bar steps aside.
  const [noteEditing, setNoteEditing] = useState(false);
  const stackPop = usePop();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });
  // Opening the note editor brings it into view, clear of the keyboard that comes up with it.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const noteTop = useRef(0);
  const parallax = useHeroParallax(scrollY);
  // The page title sits under the hero (category row above it); once its first line passes the
  // bar, the bar shows it.
  const { width } = useWindowDimensions();
  const heroHeight = (Math.min(width, COLUMN_MAX) - 32) / HERO_ASPECT;
  const titleFrom = heroHeight + 4 + 16 + 28 + 8 + 31;

  const query = useQuery({
    queryKey: ["save", id],
    queryFn: () => api.getSave(id),
    retry: (count, e) => !(e instanceof ApiError && e.code === "NOT_FOUND") && count < 2,
    refetchInterval: (q) => pollWhilePending(q.state.data ? [q.state.data] : undefined),
  });
  const card = query.data;
  const preview = useCachedSave(id);
  const back = () => goBack(router);

  useEffect(() => {
    if (!noteEditing) return;
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: Math.max(0, noteTop.current - 16), animated: true }), 150);
    return () => clearTimeout(t);
  }, [noteEditing, scrollRef]);

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
  let primary: PrimaryAction | null = null;
  if (query.isLoading) {
    body = (
      <View className="w-full max-w-[560px] self-center px-4 pb-6">
        <View className="h-1" />
        {preview ? (
          <Link.AppleZoomTarget>
            <View>
              <Hero card={preview} mediaStyle={parallax} />
            </View>
          </Link.AppleZoomTarget>
        ) : (
          <Skeleton style={{ aspectRatio: HERO_ASPECT, borderRadius: HERO_RADIUS }} />
        )}
        <SkeletonGroup label="Loading card">
          <Skeleton style={{ marginTop: 16, height: 28, width: 120, borderRadius: 999 }} />
          {preview ? (
            <Text className="mt-2 font-display text-display-lg text-ink">{cardTitle(preview)}</Text>
          ) : (
            <Skeleton style={{ marginTop: 12, height: 28, width: "80%", borderRadius: 8 }} />
          )}
          <Skeleton style={{ marginTop: 16, height: 32, width: 160, borderRadius: 999 }} />
          <Skeleton style={{ marginTop: 20, height: 14, width: "92%", borderRadius: 7 }} />
          <Skeleton style={{ marginTop: 8, height: 14, width: "76%", borderRadius: 7 }} />
          <Skeleton style={{ marginTop: 24, height: 96, borderRadius: HERO_RADIUS }} />
        </SkeletonGroup>
      </View>
    );
  } else if (!card) {
    const gone = query.error instanceof ApiError && query.error.code === "NOT_FOUND";
    body = (
      <Reveal>
        <View className="items-center px-6 pt-16">
          <Icon name={gone ? "search-off" : "cloud-off"} size={40} color={colors.ink3} />
          <Text accessibilityLiveRegion="polite" className="mt-4 text-center font-display text-display-md text-ink">
            {gone ? "This card isn't here anymore" : "Couldn't load this card"}
          </Text>
          {gone ? null : (
            <Text className="mt-2 text-center font-sans text-body text-ink-2">Check your connection and try again.</Text>
          )}
          {gone ? null : (
            <Button
              title="Try again"
              variant="secondary"
              onPress={() => query.refetch()}
              loading={query.isRefetching}
              className="mt-6 w-full max-w-[320px]"
            />
          )}
          <Button
            title="Back to Home"
            variant="secondary"
            onPress={() => router.replace("/")}
            className="mt-3 w-full max-w-[320px]"
          />
        </View>
      </Reveal>
    );
  } else {
    const pending = card.status === "pending";
    const title = cardTitle(card);
    const showCaption = card.status === "partial" || captionOpen;
    const stale = isStalePending(card, now);
    const place = card.places[0];
    const facts = deriveFacts(card);
    const tips = stepsBeyondFacts(card.steps, facts);
    primary = place
      ? { label: "Directions", icon: "place", onPress: () => Linking.openURL(mapsUrl(place)) }
      : { label: "Open in Instagram", icon: "open-in-new", onPress: () => Linking.openURL(card.source_url) };
    // The hero sits at the same place in the tree while loading and once loaded, so it stays
    // mounted (the zoom lands on it, the image never re-fades); the text below it arrives in turn.
    let i = 0;
    const next = () => i++;

    body = (
      <View className="w-full max-w-[560px] self-center px-4 pb-6 pt-1">
        <Link.AppleZoomTarget>
          <View>
            <Hero card={card} mediaStyle={parallax} showSource={!!place} />
          </View>
        </Link.AppleZoomTarget>

        <Reveal index={next()}>
          {card.category ? (
            <View className="mt-4 flex-row flex-wrap items-center">
              <CategoryPill category={card.category} />
            </View>
          ) : null}
          <Text
            accessibilityRole="header"
            className={`${card.category ? "mt-2" : "mt-4"} font-display text-display-lg text-ink`}
          >
            {title}
          </Text>
          <View className="mt-2 flex-row items-center">
            {/* A card still being read has no creator yet: its link is the meta, shortened in the middle. */}
            <Text numberOfLines={1} ellipsizeMode="middle" className="shrink font-sans text-meta text-ink-2">
              {card.creator ? `@${card.creator}` : displayLink(card.source_url)}
            </Text>
            <Text className="mx-1.5 font-sans text-meta text-ink-3">·</Text>
            <Text className="font-sans text-meta text-ink-2">{savedAgo(card.created_at, now)}</Text>
          </View>
        </Reveal>

        {pending ? (
          // The server's real step, named the way Home and the save sheet name it.
          <Reveal index={next()}>
            <SaveTracker status="pending" stage={card.stage} slow={stale} />
          </Reveal>
        ) : null}

        {facts.length ? (
          <Reveal index={next()} style={{ marginTop: 16 }}>
            <FactChips facts={facts} />
          </Reveal>
        ) : null}

        {card.summary ? (
          <Reveal index={next()} style={{ marginTop: 16 }}>
            <Text className="font-sans text-body text-ink" style={readingStyle}>
              {card.summary}
            </Text>
          </Reveal>
        ) : null}

        <View
          onLayout={(e) => {
            noteTop.current = e.nativeEvent.layout.y;
          }}
        >
          <Reveal index={next()} style={{ marginTop: 20 }}>
            <NoteBlock
              note={card.note}
              onSave={saveNote}
              onEditingChange={setNoteEditing}
              textStyle={{ fontSize: readingStyle.fontSize, lineHeight: readingStyle.lineHeight }}
            />
          </Reveal>
        </View>

        {card.status === "partial" || stale ? (
          <Reveal index={next()} style={{ marginTop: 16 }}>
            <Text className="font-sans text-meta text-ink-2">
              {stale ? "This is taking longer than usual. Lately can try again." : `${PARTIAL_NOTICE} It can try again.`}
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

        {tips.length ? (
          <Reveal index={next()} style={{ marginTop: 28 }}>
            <SectionTitle>Tips</SectionTitle>
            {tips.map((step) => (
              <View key={step} className="mt-3 flex-row items-center">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-raised">
                  <Icon name="check" size={16} color={colors.ink2} />
                </View>
                <Text className="ml-3 flex-1 font-sans text-body text-ink">{step}</Text>
              </View>
            ))}
          </Reveal>
        ) : null}

        {card.places.length ? (
          <Reveal index={next()} style={{ marginTop: 28 }}>
            <SectionTitle>{card.places.length === 1 ? "Place" : "Places"}</SectionTitle>
            <View className="mt-3 gap-3">
              {card.places.map((p) => (
                <PlaceCard key={p.name} place={p} />
              ))}
            </View>
          </Reveal>
        ) : null}

        {card.tags?.length ? (
          <Reveal index={next()} style={{ marginTop: 24 }}>
            <View className="flex-row flex-wrap gap-2">
              {card.tags.map((t) => (
                // A tag searches your saves for it, so it is a tappable chip: border and fill.
                <PressableScale
                  key={t}
                  accessibilityRole="link"
                  accessibilityLabel={`Search your saves for ${t}`}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(t)}`)}
                  scaleTo={0.95}
                  className="min-h-9 justify-center rounded-full border border-hairline bg-raised px-3 py-1.5"
                >
                  <Text className="font-sans text-body text-ink">{`#${t}`}</Text>
                </PressableScale>
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
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <TopBar onBack={back} title={card ? cardTitle(card) : undefined} titleFrom={titleFrom} scrollY={scrollY}>
        {card ? <IconButton icon="more-vert" label="More" onPress={() => setMenuOpen(true)} /> : null}
      </TopBar>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {body}
      </Animated.ScrollView>

      {card && primary && !noteEditing ? (
        <ActionBar
          primary={primary}
          onAddToStack={() => setPickerOpen(true)}
          onShare={share}
          stackIconStyle={stackPop.style}
        />
      ) : null}

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
              className="-mx-2 min-h-12 flex-row items-center rounded-xl px-2 py-2"
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
              className="-mx-2 min-h-12 flex-row items-center rounded-xl px-2 py-2"
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
        onAdded={() => stackPop.pop(DURATION.sheet)}
      />

      <ConfirmDialog
        visible={confirmOpen}
        title="Delete this save?"
        message="Its card and note leave your saves and stacks. The reel stays on Instagram."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}
