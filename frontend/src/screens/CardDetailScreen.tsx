import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, type SaveDetail } from "../api/contract";
import { useApi } from "../api/index";
import { Button } from "../components/Button";
import { CategoryDot } from "../components/CategoryDot";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NoteBlock } from "../components/detail/NoteBlock";
import { PlaceCard } from "../components/detail/PlaceCard";
import { ProgressTracker } from "../components/detail/ProgressTracker";
import { LOGO } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { Skeleton } from "../components/Skeleton";
import { Thumb } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { useNow } from "../hooks/useNow";
import { savedAgo } from "../lib/dates";
import { displayLink } from "../lib/instagram";
import { shareOrCopy } from "../lib/share";
import { colors } from "../theme/tokens";

const CHANNEL = { app_share: "Share", web: "Web", meta_dm: "DM" } as const;

function Label({ children }: { children: string }) {
  return <Text className="font-sans-semibold text-label text-ink">{children}</Text>;
}

function TopBar({ onBack, onShare }: { onBack: () => void; onShare?: () => void }) {
  return (
    <View className="h-16 flex-row items-center border-b border-hairline bg-canvas px-2">
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} className="h-12 w-12 items-center justify-center">
        <Icon name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      <Text className="font-sans-semibold text-body text-ink">Reel Detail</Text>
      <Text className="mx-1.5 font-sans text-body text-ink-3">•</Text>
      <Text className="font-display-italic text-body text-accent">Lately</Text>
      <View className="flex-1" />
      {onShare ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={onShare} className="h-12 w-12 items-center justify-center">
          <Icon name="share" size={22} color={colors.ink2} />
        </Pressable>
      ) : null}
      <Image source={LOGO} style={{ width: 36, height: 36, borderRadius: 10, marginRight: 8 }} />
    </View>
  );
}

function Overlay({ icon, text, className }: { icon: IconName; text: string; className: string }) {
  return (
    <View className={`absolute flex-row items-center rounded-full px-2.5 py-1 ${className}`} style={{ backgroundColor: "rgba(28,26,23,0.55)" }}>
      <Icon name={icon} size={14} color="#FFFFFF" />
      <Text className="ml-1 font-sans-semibold text-caption text-on-accent">{text}</Text>
    </View>
  );
}

function Hero({ card }: { card: SaveDetail }) {
  const openIg = (
    <Pressable
      accessibilityRole="link"
      onPress={() => Linking.openURL(card.source_url)}
      className="absolute bottom-3 left-3 h-10 flex-row items-center rounded-full border px-4"
      style={{ backgroundColor: "rgba(28,26,23,0.55)", borderColor: "rgba(255,255,255,0.35)" }}
    >
      <Text className="font-sans-semibold text-meta text-on-accent">Open in Instagram</Text>
      <Icon name="north-east" size={16} color="#FFFFFF" />
    </Pressable>
  );
  if (card.status === "pending") {
    return (
      <Thumb uri={null} className="border border-hairline">
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
      <Thumb uri={null} className="border border-hairline">
        <View className="flex-1 items-center justify-center bg-raised">
          <Icon name="image-not-supported" size={40} color={colors.ink3} />
          <Text className="mt-2 font-sans-medium text-body text-ink-2">Preview unavailable</Text>
        </View>
        {openIg}
      </Thumb>
    );
  }
  return (
    <Thumb uri={card.thumbnail_url} className="border border-hairline">
      <Overlay icon="smart-display" text="Reel" className="right-3 top-3" />
      {openIg}
    </Thumb>
  );
}

export function CardDetailScreen({ readingStyle }: { readingStyle?: TextStyle } = {}) {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);

  const query = useQuery({
    queryKey: ["save", id],
    queryFn: () => api.getSave(id),
    retry: (count, e) => !(e instanceof ApiError && e.code === "NOT_FOUND") && count < 2,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 4000 : false),
  });
  const card = query.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  async function share() {
    if (!card) return;
    const how = await shareOrCopy({ title: card.title ?? displayLink(card.source_url), url: card.source_url });
    if (how === "copied") toast.show("Link copied");
  }

  async function saveNote(note: string) {
    const updated = await api.setNote(id, note);
    queryClient.setQueryData<SaveDetail>(["save", id], (old) => (old ? { ...old, note: updated.note } : old));
    queryClient.invalidateQueries({ queryKey: ["saves"] });
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.deleteSave(id);
      queryClient.removeQueries({ queryKey: ["save", id] });
      queryClient.invalidateQueries({ queryKey: ["saves"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["stacks"] });
      setConfirmOpen(false);
      toast.show("Deleted");
      back();
    } catch {
      toast.show("Couldn't delete. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  let body: ReactNode;
  if (query.isLoading) {
    body = <ActivityIndicator className="mt-16" color={colors.accent} />;
  } else if (!card) {
    const gone = query.error instanceof ApiError && query.error.code === "NOT_FOUND";
    body = (
      <View className="items-center px-6 pt-16">
        <Icon name={gone ? "search-off" : "cloud-off"} size={40} color={colors.ink3} />
        <Text className="mt-4 text-center font-display text-display-md text-ink">
          {gone ? "This card isn't here anymore" : "Couldn't load this card"}
        </Text>
        <Button title="Back to Library" variant="secondary" onPress={() => router.replace("/")} className="mt-6 w-full max-w-[320px]" />
      </View>
    );
  } else {
    const status =
      card.status === "pending"
        ? { text: "GETTING DETAILS", color: colors.accent }
        : card.status === "partial"
          ? { text: "PREVIEW UNAVAILABLE", color: colors.ink3 }
          : { text: "READY • SYNCED", color: colors.success };
    const title = card.title ?? (card.status === "pending" ? displayLink(card.source_url) : card.caption?.split("\n")[0] ?? displayLink(card.source_url));
    const showCaption = card.status === "partial" || captionOpen;

    body = (
      <View className="w-full max-w-[560px] self-center px-4 pb-10">
        <View className="h-12 flex-row items-center">
          <View className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
          <Text className="ml-2 flex-1 font-sans-semibold text-label text-ink-2">{status.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => setMenuOpen(true)} className="h-12 w-12 items-center justify-center">
            <Icon name="more-vert" size={22} color={colors.ink2} />
          </Pressable>
        </View>

        <Hero card={card} />

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
        </View>

        <View className="my-5 h-px bg-hairline" />
        <NoteBlock note={card.note} onSave={saveNote} textStyle={readingStyle} />

        {card.status === "pending" ? (
          <View className="mt-5">
            <ProgressTracker current={1} />
          </View>
        ) : null}

        {card.summary ? (
          <View className="mt-6">
            <Label>SUMMARY</Label>
            <Text className="mt-2 font-sans text-body text-ink" style={readingStyle}>
              {card.summary}
            </Text>
          </View>
        ) : null}

        {card.steps?.length ? (
          <View className="mt-6">
            <Label>GOOD TO KNOW</Label>
            {card.steps.map((step) => (
              <View key={step} className="mt-3 flex-row items-center">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-raised">
                  <Icon name="check" size={16} color={colors.accent} />
                </View>
                <Text className="ml-3 flex-1 font-sans text-body text-ink">{step}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {card.places.length ? (
          <View className="mt-6 gap-3">
            {card.places.map((p) => (
              <PlaceCard key={p.name} place={p} />
            ))}
          </View>
        ) : null}

        {card.tags?.length ? (
          <View className="mt-6 flex-row flex-wrap gap-2">
            {card.tags.map((t) => (
              <View key={t} className="h-9 justify-center rounded-full border border-hairline bg-raised px-3">
                <Text className="font-sans text-body text-ink-2">{`#${t}`}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {card.caption ? (
          <View className="mt-6 border-t border-hairline">
            <Pressable
              accessibilityRole="button"
              onPress={() => setCaptionOpen((o) => !o)}
              className="h-14 flex-row items-center"
            >
              <Icon name="description" size={20} color={colors.ink2} />
              <Text className="ml-3 flex-1 font-sans text-body text-ink-2">Original caption</Text>
              <Icon name={showCaption ? "expand-less" : "expand-more"} size={22} color={colors.ink2} />
            </Pressable>
            {showCaption ? <Text className="pb-4 font-sans text-body text-ink" style={readingStyle}>{card.caption}</Text> : null}
          </View>
        ) : null}

        <View className="mt-2 flex-row items-center border-t border-hairline pt-5">
          <Image source={LOGO} style={{ width: 20, height: 20, borderRadius: 5 }} />
          <Text className="ml-2 flex-1 font-sans text-meta text-ink-2">
            Saved to <Text className="font-sans-semibold text-ink">Lately</Text> via {CHANNEL[card.channel]}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={share}
            className="h-10 flex-row items-center rounded-full border border-hairline bg-card px-4 active:bg-raised"
          >
            <Icon name="ios-share" size={16} color={colors.ink} />
            <Text className="ml-1.5 font-sans-semibold text-meta text-ink">Export</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <TopBar onBack={back} onShare={card ? share : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>{body}</ScrollView>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        {card ? (
          <View className="pb-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                Linking.openURL(card.source_url);
              }}
              className="h-12 flex-row items-center"
            >
              <Icon name="open-in-new" size={22} color={colors.ink} />
              <Text className="ml-3 font-sans-medium text-body text-ink">Open in Instagram</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
              className="h-12 flex-row items-center"
            >
              <Icon name="delete-outline" size={22} color={colors.danger} />
              <Text className="ml-3 font-sans-medium text-body text-danger">Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </Sheet>

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
