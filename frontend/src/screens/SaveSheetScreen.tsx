import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useApi } from "../api/index";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { LOGO } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { BACKDROP, SheetPanel } from "../components/Sheet";
import { useNow } from "../hooks/useNow";
import { savedAgo, shortDate } from "../lib/dates";
import { displayLink, extractReelUrl } from "../lib/instagram";
import { outcomeFromError, outcomeFromResult, type SaveOutcome } from "../lib/saveOutcome";
import { colors } from "../theme/tokens";

const SHARE_BACKDROP = require("../../assets/stitch/save-bg.jpg");
const QUICK = ["To try", "To buy", "To visit", "To learn", "Watch later"];
const AUTO_CLOSE_S = 5;

function StatusIcon({ name, color, bg }: { name: IconName; color: string; bg: string }) {
  return (
    <View className="h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: bg }}>
      <Icon name={name} size={28} color={color} />
    </View>
  );
}

function Message({ icon, title, body, children }: { icon: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <View>
      <View className="flex-row items-center">
        {icon}
        <View className="ml-3 flex-1">
          <Text className="font-display text-display-md text-ink">{title}</Text>
          {body ? <Text className="mt-0.5 font-sans text-body text-ink-2">{body}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

export function SaveSheetScreen() {
  const { text } = useLocalSearchParams<{ text?: string }>();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const shared = !!text;
  const now = useNow();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(shared);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [savedText, setSavedText] = useState(text ?? "");
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CLOSE_S);
  const inFlight = useRef(false);
  const started = useRef(false);

  // Opened straight from a share (or a link) there is no screen to go back to.
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  const save = useCallback(
    async (t: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setSavedText(t);
      try {
        const result = await api.createSave(t);
        setOutcome(outcomeFromResult(result));
        queryClient.invalidateQueries({ queryKey: ["saves"] });
        queryClient.invalidateQueries({ queryKey: ["me"] });
      } catch (e) {
        setOutcome(outcomeFromError(e));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, queryClient],
  );

  // A share hands us the text: save immediately (once).
  useEffect(() => {
    if (text && !started.current) {
      started.current = true;
      save(text);
    }
  }, [text, save]);

  // Saved: count down and close unless the user starts writing a note.
  const counting = outcome?.kind === "saved" && !noteTouched;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [counting]);
  useEffect(() => {
    if (counting && secondsLeft <= 0) close();
  }, [counting, secondsLeft, close]);

  const reelId = outcome && "reelId" in outcome ? outcome.reelId : null;
  const existing = useQuery({
    queryKey: ["save", reelId],
    queryFn: () => api.getSave(reelId as string),
    enabled: outcome?.kind === "deduped" && !!reelId,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.getMe(), enabled: outcome?.kind === "quota" });

  async function saveNote() {
    if (!reelId || !note.trim()) return;
    setSavingNote(true);
    try {
      await api.setNote(reelId, note.trim());
      queryClient.invalidateQueries({ queryKey: ["saves"] });
      close();
    } finally {
      setSavingNote(false);
    }
  }

  const link = displayLink(extractReelUrl(savedText)?.url ?? savedText);

  let content: ReactNode;
  if (busy || (shared && !outcome)) {
    content = (
      <View className="items-center py-10">
        <ActivityIndicator color={colors.accent} />
        <Text className="mt-3 font-sans text-body text-ink-2">Saving…</Text>
      </View>
    );
  } else if (!outcome) {
    content = (
      <View>
        <Text className="font-display text-display-md text-ink">Paste a reel link</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="instagram.com/reel/…"
          placeholderTextColor={colors.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={() => input.trim() && save(input.trim())}
          className="mt-4 h-12 rounded-ctl border border-hairline bg-canvas px-4 font-sans text-body text-ink"
        />
        <Button title="Save" onPress={() => save(input.trim())} disabled={!input.trim()} className="mt-4" />
        <Button title="Cancel" variant="ghost" onPress={close} className="mt-1" />
      </View>
    );
  } else if (outcome.kind === "saved") {
    content = (
      <View>
        <View className="flex-row items-center">
          <View>
            <Image source={LOGO} style={{ width: 56, height: 56, borderRadius: 14 }} />
            <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-success">
              <Icon name="check" size={14} color="#FFFFFF" />
            </View>
          </View>
          <View className="ml-3 flex-1">
            <Text className="font-display text-display-lg text-ink">Saved to Lately</Text>
            <Text className="font-sans text-body text-ink-2">Your card will be ready in a few seconds.</Text>
          </View>
        </View>
        <View className="mt-4 h-9 flex-row items-center self-start rounded-full border border-hairline bg-raised px-3" style={{ maxWidth: "100%" }}>
          <Icon name="link" size={18} color={colors.accent} />
          <Text numberOfLines={1} className="ml-2 shrink font-sans text-meta text-ink-2">
            {link}
          </Text>
        </View>
        <Text className="mt-5 font-sans-medium text-body text-ink-2">
          Why are you saving this? <Text className="font-sans text-meta text-ink-3">(optional)</Text>
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          onFocus={() => setNoteTouched(true)}
          placeholder="e.g. cafe to try in June"
          placeholderTextColor={colors.ink3}
          maxLength={500}
          className="mt-2 h-14 rounded-xl border border-hairline bg-canvas px-4 font-sans text-body text-ink"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 8 }}>
          {QUICK.map((q) => (
            <Chip
              key={q}
              label={q}
              active={note === q}
              onPress={() => {
                setNoteTouched(true);
                setNote(q);
              }}
            />
          ))}
        </ScrollView>
        <Button title="Save note" onPress={saveNote} disabled={!note.trim()} loading={savingNote} className="mt-5 h-14" />
        <Button title="Skip" variant="ghost" onPress={close} className="mt-1" />
        {counting ? (
          <Text className="mt-1 text-center font-sans text-meta text-ink-3">{`Closes in ${Math.max(secondsLeft, 0)} s`}</Text>
        ) : null}
      </View>
    );
  } else if (outcome.kind === "deduped") {
    const card = existing.data;
    content = (
      <Message
        icon={<StatusIcon name="info-outline" color={colors.ink2} bg={colors.raised} />}
        title="Already in your Lately"
        body={card ? `${savedAgo(card.created_at, now)}.` : " "}
      >
        {card?.note ? (
          <Text className="mt-4 rounded-xl bg-raised px-4 py-3 font-sans-italic text-body text-ink-2">{`“${card.note}”`}</Text>
        ) : null}
        <Button title="Open card" onPress={() => router.replace(`/reel/${outcome.reelId}`)} className="mt-5" />
        <Button title="Close" variant="ghost" onPress={close} className="mt-1" />
      </Message>
    );
  } else if (outcome.kind === "bad_url") {
    content = (
      <Message
        icon={<StatusIcon name="error-outline" color={colors.danger} bg={colors.dangerSoft} />}
        title="No reel link found"
        body="Share the reel itself, not a profile or story."
      >
        <Button title="Close" onPress={close} className="mt-5" />
      </Message>
    );
  } else if (outcome.kind === "quota") {
    const limit = me.data?.saves_limit ?? 20;
    content = (
      <Message icon={<StatusIcon name="lock-outline" color={colors.accent} bg={colors.raised} />} title={`You've used all ${limit} free saves this month`}>
        <View className="mt-4 h-2 overflow-hidden rounded-full bg-raised">
          <View className="h-2 w-full rounded-full bg-accent" />
        </View>
        <Text className="mt-1 self-end font-sans-semibold text-meta text-ink-2">{`${limit}/${limit}`}</Text>
        {me.data ? (
          <Text className="mt-2 font-sans text-body text-ink-2">{`Saves reset on ${shortDate(me.data.resets_on)}.`}</Text>
        ) : null}
        <Button title="Close" onPress={close} className="mt-5" />
      </Message>
    );
  } else if (outcome.kind === "rate_limited") {
    content = (
      <Message
        icon={<StatusIcon name="schedule" color={colors.accent} bg={colors.raised} />}
        title="That's a lot of saves at once"
        body="Try again in a minute."
      >
        <Button title="Close" onPress={close} className="mt-5" />
      </Message>
    );
  } else {
    content = (
      <Message
        icon={<StatusIcon name="cloud-off" color={colors.ink2} bg={colors.raised} />}
        title="Couldn't reach Lately"
        body="Check your connection and try again."
      >
        <Button title="Try again" onPress={() => save(savedText)} className="mt-5" />
        <Button title="Close" variant="ghost" onPress={close} className="mt-1" />
      </Message>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
      {shared ? (
        <Image source={SHARE_BACKDROP} contentFit="cover" blurRadius={8} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
      ) : null}
      <Pressable
        accessibilityLabel="Close"
        onPress={close}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: shared ? "rgba(28,26,23,0.55)" : BACKDROP }}
      />
      <SheetPanel>{content}</SheetPanel>
    </KeyboardAvoidingView>
  );
}
