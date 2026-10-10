import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useApi } from "../api/index";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { LOGO } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { PopIn, Reveal } from "../components/motion/Reveal";
import { usePresence } from "../components/motion/usePresence";
import { BACKDROP, SHEET_RESIZE, SheetPanel, useSheetMotion } from "../components/Sheet";
import { TextField } from "../components/TextField";
import { useNow } from "../hooks/useNow";
import { savedAgo, shortDate } from "../lib/dates";
import { haptic } from "../lib/haptics";
import { displayLink, extractReelUrl } from "../lib/instagram";
import { outcomeFromError, outcomeFromResult, QUEUE_REASON, QUEUED_BODY, type SaveOutcome } from "../lib/saveOutcome";
import { DURATION, EASE_OUT } from "../theme/motion";
import { colors } from "../theme/tokens";
import { useToast } from "../components/Toast";
import { refreshSaveViews } from "../lib/queryClient";
import { useSaveQueue } from "../hooks/useSaveQueue";
import { ApiError } from "../api/contract";
import { config } from "../config";
import { sendDeviceHint } from "../lib/deviceFetch";

const SHARE_BACKDROP = require("../../assets/stitch/save-bg.jpg");
const QUICK = ["To try", "To buy", "To visit", "To learn", "Watch later"];
const AUTO_CLOSE_S = 5;

// Each state of the sheet dissolves in; the sheet's height eases to fit it.
const STATE_IN = FadeIn.duration(DURATION.state);

function StatusIcon({ name, color, bg }: { name: IconName; color: string; bg: string }) {
  return (
    <PopIn style={[styles.statusIcon, { backgroundColor: bg }]}>
      <Icon name={name} size={28} color={color} />
    </PopIn>
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

/** The success mark: the logo settles while the green tick springs onto its corner. */
function SavedMark() {
  return (
    <View>
      <Image source={LOGO} style={{ width: 56, height: 56, borderRadius: 14 }} />
      <PopIn style={styles.badge}>
        <Icon name="check" size={14} color="#FFFFFF" />
      </PopIn>
    </View>
  );
}

/** A hairline that drains over the auto-close countdown; it fades away if the user starts a note. */
function CountdownLine({ running }: { running: boolean }) {
  const left = useSharedValue(1);
  const shown = useSharedValue(1);
  useEffect(() => {
    if (running) {
      left.set(withTiming(0, { duration: AUTO_CLOSE_S * 1000, easing: Easing.linear }));
    } else {
      cancelAnimation(left);
      shown.set(withTiming(0, { duration: DURATION.exit, easing: EASE_OUT }));
    }
  }, [running, left, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ scaleX: left.get() }] }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, style]} />
    </View>
  );
}

export function SaveSheetScreen() {
  const { text } = useLocalSearchParams<{ text?: string }>();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const queue = useSaveQueue();
  const queuedRef = useRef(false);
  const shared = !!text;
  const now = useNow();
  const { motion, backdropStyle } = useSheetMotion();
  usePresence(true, motion.progress);

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
        // Fire-and-forget: the phone reads the reel itself and hands the server a hint
        // (Instagram often blocks the server). Never awaited, never throws.
        void sendDeviceHint({ api, mode: config.apiMode, platform: Platform.OS, text: t, result });
        // A manual retry of a queued save landed: it no longer needs the queue.
        if (queuedRef.current) {
          queuedRef.current = false;
          queue.dequeue(t);
        }
        const next = outcomeFromResult(result);
        // The confirmation lands with its haptic, in the same frame the success mark appears.
        if (next.kind === "saved") haptic.success();
        setOutcome(next);
        refreshSaveViews(queryClient);
      } catch (e) {
        const reason = e instanceof ApiError ? QUEUE_REASON[e.code] : undefined;
        if (reason) {
          // Nothing the server said about the link itself: keep it on the device and send it
          // when Lately can take it — but only if there is a reel link to send.
          if (!extractReelUrl(t)) {
            haptic.error();
            setOutcome({ kind: "bad_url" });
            return;
          }
          await queue.enqueue(t);
          queuedRef.current = true;
          haptic.light();
          setOutcome({ kind: "queued", reason });
          return;
        }
        const next = outcomeFromError(e);
        if (next.kind !== "deduped") haptic.error();
        setOutcome(next);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, queryClient, queue],
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

  const noteInFlight = useRef(false);
  async function saveNote() {
    if (!reelId || !note.trim() || noteInFlight.current) return;
    noteInFlight.current = true;
    setSavingNote(true);
    try {
      await api.setNote(reelId, note.trim());
      refreshSaveViews(queryClient);
      // Stays latched: the sheet is closing, a second tap must not send the note again.
      close();
    } catch {
      noteInFlight.current = false;
      haptic.error();
      toast.show("Couldn't save your note. Try again.");
    } finally {
      setSavingNote(false);
    }
  }

  const link = displayLink(extractReelUrl(savedText)?.url ?? savedText);
  const phase = busy || (shared && !outcome) ? "busy" : outcome ? outcome.kind : "paste";

  let content: ReactNode;
  if (phase === "busy") {
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
        <TextField
          value={input}
          onChangeText={setInput}
          placeholder="instagram.com/reel/…"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={() => input.trim() && save(input.trim())}
          className="mt-4"
        />
        <Button title="Save" onPress={() => save(input.trim())} disabled={!input.trim()} className="mt-4" />
        <Button title="Cancel" variant="ghost" onPress={close} className="mt-1" />
      </View>
    );
  } else if (outcome.kind === "saved") {
    content = (
      <View>
        <View className="flex-row items-center">
          <SavedMark />
          <Reveal index={1} style={{ marginLeft: 12, flex: 1 }}>
            <Text className="font-display text-display-lg text-ink">Saved to Lately</Text>
            <Text className="font-sans text-body text-ink-2">Your card will be ready in a few seconds.</Text>
          </Reveal>
        </View>
        <Reveal index={2}>
          <View className="mt-4 h-9 flex-row items-center self-start rounded-full border border-hairline bg-raised px-3" style={{ maxWidth: "100%" }}>
            <Icon name="link" size={18} color={colors.accent} />
            <Text numberOfLines={1} className="ml-2 shrink font-sans text-meta text-ink-2">
              {link}
            </Text>
          </View>
        </Reveal>
        <Reveal index={3}>
          <Text className="mt-5 font-sans-medium text-body text-ink-2">
            Why are you saving this? <Text className="font-sans text-meta text-ink-3">(optional)</Text>
          </Text>
          <TextField
            value={note}
            onChangeText={setNote}
            onFocus={() => setNoteTouched(true)}
            placeholder="e.g. cafe to try in June"
            maxLength={500}
            size="lg"
            className="mt-2"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 8 }}>
            {QUICK.map((q) => (
              <Chip
                key={q}
                label={q}
                active={note === q}
                haptic="selection"
                onPress={() => {
                  setNoteTouched(true);
                  setNote(q);
                }}
              />
            ))}
          </ScrollView>
        </Reveal>
        <Reveal index={4}>
          <Button title="Save note" onPress={saveNote} disabled={!note.trim()} loading={savingNote} size="lg" className="mt-5" />
          <Button title="Skip" variant="ghost" onPress={close} className="mt-1" />
          {counting ? (
            <Text className="mt-1 text-center font-sans text-meta text-ink-3">{`Closes in ${Math.max(secondsLeft, 0)} s`}</Text>
          ) : null}
          <CountdownLine running={counting} />
        </Reveal>
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
          <Animated.View entering={STATE_IN}>
            <Text className="mt-4 rounded-xl bg-raised px-4 py-3 font-sans-italic text-body text-ink-2">{`“${card.note}”`}</Text>
          </Animated.View>
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
  } else if (outcome.kind === "queued") {
    content = (
      <Message
        icon={<StatusIcon name="cloud-upload" color={colors.accent} bg={colors.raised} />}
        title="Saved for later"
        body={QUEUED_BODY[outcome.reason]}
      >
        <View className="mt-4 h-9 flex-row items-center self-start rounded-full border border-hairline bg-raised px-3" style={{ maxWidth: "100%" }}>
          <Icon name="link" size={18} color={colors.accent} />
          <Text numberOfLines={1} className="ml-2 shrink font-sans text-meta text-ink-2">
            {link}
          </Text>
        </View>
        <Button title="Try again now" variant="secondary" onPress={() => save(savedText)} className="mt-5" />
        <Button title="Close" variant="ghost" onPress={close} className="mt-1" />
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
        <Image source={SHARE_BACKDROP} contentFit="cover" blurRadius={8} style={StyleSheet.absoluteFill} />
      ) : null}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: shared ? "rgba(28,26,23,0.55)" : BACKDROP }, backdropStyle]}
      >
        <Pressable accessibilityLabel="Close" onPress={close} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <SheetPanel motion={motion} onDismiss={close} layout={SHEET_RESIZE}>
        <Animated.View key={phase} entering={phase === "busy" ? undefined : STATE_IN}>
          {content}
        </Animated.View>
      </SheetPanel>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  statusIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { marginTop: 8, height: 2, width: 64, alignSelf: "center", borderRadius: 1, backgroundColor: colors.raised, overflow: "hidden" },
  fill: { flex: 1, backgroundColor: colors.ink3, transformOrigin: "left" },
});
