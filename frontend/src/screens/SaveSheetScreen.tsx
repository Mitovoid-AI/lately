import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { useApi } from "../api/index";
import { useAuth } from "../auth/AuthProvider";
import { useBilling } from "../billing/BillingProvider";
import { PRO_CONFIRMING } from "../billing/plans";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Icon, type IconName } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { PopIn, Reveal } from "../components/motion/Reveal";
import { usePresence } from "../components/motion/usePresence";
import { Celebrate, SavedCheck } from "../components/save/Celebrate";
import { isFirstCard } from "../components/save/firstCard";
import { SaveTracker } from "../components/save/SaveTracker";
import { SHEET_RESIZE, SheetPanel, useSheetMotion } from "../components/Sheet";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import { useNow } from "../hooks/useNow";
import { useSaveProgress } from "../hooks/useSaves";
import { savedAgo, shortDate } from "../lib/dates";
import { useDevicePrefs } from "../lib/devicePrefs";
import { haptic } from "../lib/haptics";
import { displayLink, readInstagramLink } from "../lib/instagram";
import {
  badLinkOutcome,
  NOT_REEL_MESSAGE,
  outcomeFromError,
  outcomeFromResult,
  QUEUE_REASON,
  QUEUED_BODY,
  type SaveOutcome,
} from "../lib/saveOutcome";
import { DURATION } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { refreshSaveViews } from "../lib/queryClient";
import { deviceStore, type KeyValueStore } from "../lib/storage";
import { useSaveQueue } from "../hooks/useSaveQueue";
import { ApiError } from "../api/contract";
import { config } from "../config";
import { sendDeviceHint } from "../lib/deviceFetch";
import { canReturnToSharer, FROM_SHARE, returnToSharer } from "../share/returnToSharer";

const QUICK = ["To try", "To buy", "To visit", "To learn", "Watch later"];

/** With "After sharing: save and go back", how long the confirmation shows before the sheet goes back. */
export const AUTO_RETURN_MS = 1500;

/** Said under the paste field, which keeps what was typed. */
export const PASTE_NO_LINK = "No reel link found. Paste a link to an Instagram reel or post.";
export const PASTE_EMPTY = "Nothing to paste. Copy the reel's link first.";
export const PASTE_FAILED = "Couldn't paste. Long-press the field to paste instead.";
/** A note that could not be sent as the sheet closed: said wherever the person is now. */
export const NOTE_LOST = "Couldn't save your note. You can add it on the card.";

// Each state of the sheet dissolves in; the sheet's height eases to fit it.
const STATE_IN = FadeIn.duration(DURATION.state);

/** How tall the on-screen keyboard is right now (0 when it is down), so the sheet can leave it room. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** What the sheet's chrome (handle, padding, safe area) takes when the keyboard is up. */
const SHEET_CHROME = 140;

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
          {/* A live region: the outcome is spoken as it appears (role "alert" is silent on Android). */}
          <Text accessibilityLiveRegion="polite" accessibilityRole="header" className="font-display text-display-md text-ink">
            {title}
          </Text>
          {body ? <Text className="mt-0.5 font-sans text-body text-ink-2">{body}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

/** The reel's link, small, so it is clear which reel this is about. A static chip: fill only. */
function LinkChip({ link }: { link: string }) {
  const { colors } = useTheme();
  return (
    <View className="mt-4 min-h-9 flex-row items-center self-start rounded-full bg-raised px-3 py-1.5" style={{ maxWidth: "100%" }}>
      <Icon name="link" size={18} color={colors.ink2} />
      <Text numberOfLines={1} ellipsizeMode="middle" className="ml-2 shrink font-sans text-meta text-ink-2">
        {link}
      </Text>
    </View>
  );
}

/**
 * The sheet that saves a reel (pasted or shared) and then follows its card being made. The
 * `firstCardStore` is where "this person's first card" is remembered; tests pass a memory store.
 */
export function SaveSheetScreen({ firstCardStore = deviceStore }: { firstCardStore?: KeyValueStore } = {}) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const { user } = useAuth();
  const { text, from } = useLocalSearchParams<{ text?: string; from?: string }>();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const queue = useSaveQueue();
  const billing = useBilling();
  const toast = useToast();
  const { afterShare } = useDevicePrefs();
  const queuedRef = useRef(false);
  const shared = !!text;
  // Opened by a share from another app (Android): closing goes back to that app. With "After
  // sharing: save and go back" on, the sheet also goes back by itself once the reel is safe.
  const fromShare = from === FROM_SHARE && canReturnToSharer();
  const autoReturn = fromShare && afterShare === "return";
  const now = useNow();
  const { motion, backdropStyle } = useSheetMotion();
  usePresence(true, motion.progress);

  const [input, setInput] = useState("");
  // Why the pasted text was not saved (or could not be pasted), said under the field.
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(shared);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [savedText, setSavedText] = useState(text ?? "");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  // Saying the note did not save belongs under the note, where the person is looking.
  const [noteFailed, setNoteFailed] = useState(false);
  // The first card this person has ever saved gets one small celebration when it is ready.
  const [first, setFirst] = useState(false);
  // Once the sheet starts closing, nothing here asks the server anything more.
  const [closed, setClosed] = useState(false);
  const inFlight = useRef(false);
  const started = useRef(false);
  const userId = user?.id;

  // The store can say Pro is on a moment before the server hears it. A save that hits the
  // free limit then tells the server and tries once more, before the sheet gives up on it.
  const createSave = useCallback(
    async (t: string) => {
      try {
        return await api.createSave(t);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "QUOTA_EXCEEDED" && billing.proActive)) throw e;
        await billing.syncPlan();
        return api.createSave(t);
      }
    },
    [api, billing],
  );

  const save = useCallback(
    async (t: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setSavedText(t);
      try {
        const result = await createSave(t);
        // Fire-and-forget: the phone reads the reel itself and hands the server a hint
        // (Instagram often blocks the server). Never awaited, never throws.
        void sendDeviceHint({ api, mode: config.apiMode, platform: Platform.OS, text: t, result });
        // A manual retry of a queued save landed: it no longer needs the queue.
        if (queuedRef.current) {
          queuedRef.current = false;
          queue.dequeue(t);
        }
        const next = outcomeFromResult(result);
        // The confirmation lands with its haptic, in the same frame the check appears. The
        // stronger success haptic is kept for the card being ready.
        if (next.kind === "saved") {
          haptic.light();
          if (userId) {
            // The demo account comes with a library, so there "first" means the first save in it.
            const total = async () => (config.apiMode === "demo" ? 1 : (await api.getMe()).total_saves);
            void isFirstCard(firstCardStore, userId, total).then(setFirst);
          }
        }
        setOutcome(next);
        refreshSaveViews(queryClient);
      } catch (e) {
        // A link Lately won't save. Pasted: back to the field, the text kept, saying why there.
        const refuse = () => {
          const bad = badLinkOutcome(t);
          if (shared) return setOutcome(bad);
          setOutcome(null);
          setPasteError(bad.notReel ? NOT_REEL_MESSAGE : PASTE_NO_LINK);
        };
        const reason = e instanceof ApiError ? QUEUE_REASON[e.code] : undefined;
        if (reason) {
          // Nothing the server said about the link itself: keep it on the device and send it
          // when Lately can take it — but only if it has a link the server would save.
          const link = readInstagramLink(t);
          if (link?.kind !== "reel" && link?.kind !== "share") {
            haptic.error();
            refuse();
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
        if (next.kind === "bad_url") refuse();
        else setOutcome(next);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, createSave, queryClient, queue, userId, firstCardStore, shared],
  );

  // A share hands us the text: save immediately (once).
  useEffect(() => {
    if (text && !started.current) {
      started.current = true;
      save(text);
    }
  }, [text, save]);

  const reelId = outcome && "reelId" in outcome ? outcome.reelId : null;
  const existing = useQuery({
    queryKey: ["save", reelId],
    queryFn: () => api.getSave(reelId as string),
    enabled: outcome?.kind === "deduped" && !!reelId,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.getMe(), enabled: outcome?.kind === "quota" });

  // Saved: follow the card being made, step by step, for as long as the sheet is open.
  const progress = useSaveProgress(outcome?.kind === "saved" ? reelId : null, !closed);
  const readyFired = useRef(false);
  useEffect(() => {
    if (!progress.ready || readyFired.current) return;
    readyFired.current = true;
    // A card that came out whole lands with the success haptic; a part-read one just taps.
    if (progress.status === "enriched") haptic.success();
    else haptic.light();
  }, [progress.ready, progress.status]);
  const celebrating = first && progress.status === "enriched";

  // A /share/ link to a reel already in the library: the server finds the duplicate a few seconds
  // after the save (any other link it catches at once) and removes the new one, so the card being
  // followed answers "not found". That is "already saved", not an error, but only for the /share/
  // save this sheet just made, before its card was ever ready. (`existing` reads the same query as
  // the tracker, so it sees that answer.)
  const vanished =
    outcome?.kind === "saved" &&
    !progress.ready &&
    readInstagramLink(savedText)?.kind === "share" &&
    existing.error instanceof ApiError &&
    existing.error.code === "NOT_FOUND";
  useEffect(() => {
    // The new save is gone: Home must not keep showing it.
    if (vanished) refreshSaveViews(queryClient);
  }, [vanished, queryClient]);

  const noteInFlight = useRef(false);
  /** A note typed (or a chip picked) and not saved yet goes along as the sheet closes, in the background. */
  function keepNote() {
    const t = note.trim();
    if (outcome?.kind !== "saved" || vanished || !reelId || !t || noteInFlight.current) return;
    noteInFlight.current = true;
    // Closing never waits for it; if it fails, a toast says so wherever the person is now.
    api.setNote(reelId, t).then(
      () => refreshSaveViews(queryClient),
      () => toast.show(NOTE_LOST),
    );
  }

  // Once the sheet is leaving, nothing closes it again or sends it somewhere else (a second tap,
  // the auto-return timer, Back).
  const leaving = useRef(false);
  /** Leaves the sheet: for somewhere in Lately (a card, Home) or back where it came from. */
  function leave(go: () => void) {
    if (leaving.current) return;
    leaving.current = true;
    setClosed(true);
    go();
  }

  // Every way of closing (Done, Close, a swipe, a tap outside, Back) keeps a typed note. Opened
  // straight from a share (or a link) there is no screen to go back to.
  function close() {
    if (leaving.current) return;
    keepNote();
    leave(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/");
      // A share from another app: back to that app, not to Lately's Home.
      if (fromShare) returnToSharer();
    });
  }
  // A stable handle for the sheet's swipe, the scrim, Back and the auto-return timer.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const requestClose = useCallback(() => closeRef.current(), []);

  // Android Back closes the sheet the way Done does, instead of only popping the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // "Save and go back": once the reel is safe (saved, saved already, or waiting on this phone) the
  // confirmation shows for a moment, then the sheet goes back to the app the share came from.
  // Anything that needs a decision (an error, the monthly limit) stays until it is closed.
  const safe = !busy && (outcome?.kind === "saved" || outcome?.kind === "deduped" || outcome?.kind === "queued");
  useEffect(() => {
    if (!autoReturn || !safe) return;
    const id = setTimeout(() => closeRef.current(), AUTO_RETURN_MS);
    return () => clearTimeout(id);
  }, [autoReturn, safe]);

  /** Saves the typed note, then runs `then` (closing the sheet, or opening the card). */
  async function saveNote(then: () => void = close) {
    if (!reelId || !note.trim() || noteInFlight.current) return;
    noteInFlight.current = true;
    setSavingNote(true);
    setNoteFailed(false);
    try {
      await api.setNote(reelId, note.trim());
      refreshSaveViews(queryClient);
      // Stays latched: the sheet is closing, a second tap must not send the note again.
      then();
    } catch {
      noteInFlight.current = false;
      haptic.error();
      // Closed (a swipe, Back) while it was being sent: say so wherever the person is now.
      if (leaving.current) toast.show(NOTE_LOST);
      else setNoteFailed(true);
    } finally {
      setSavingNote(false);
    }
  }

  function openCard() {
    if (!reelId) return;
    const go = () => leave(() => router.replace(`/reel/${reelId}`));
    // A note typed while waiting is kept, not dropped on the way to the card.
    if (note.trim()) void saveNote(go);
    else go();
  }

  /** Pasted text goes as the link itself, not the words around it (a bare instagram.com/reel/… gets its https://). */
  function submitPasted() {
    const typed = input.trim();
    if (!typed) return;
    setPasteError(null);
    const found = readInstagramLink(typed);
    save(found && found.kind !== "not_reel" ? found.url : typed);
  }

  async function pasteLink() {
    setPasteError(null);
    try {
      const clip = (await Clipboard.getStringAsync()).trim();
      if (clip) setInput(clip);
      else setPasteError(PASTE_EMPTY);
    } catch {
      setPasteError(PASTE_FAILED);
    }
  }

  const link = displayLink(readInstagramLink(savedText)?.url ?? savedText);
  // The saved sheet scrolls; with the keyboard up it may take only what the keyboard leaves.
  const scrollMax =
    keyboardHeight > 0 ? Math.max(180, Math.round(windowHeight - keyboardHeight - SHEET_CHROME)) : Math.round(windowHeight * 0.78);
  const phase = busy || (shared && !outcome) ? "busy" : vanished ? "vanished" : outcome ? outcome.kind : "paste";

  let content: ReactNode;
  if (phase === "busy") {
    content = (
      <View className="items-center py-10">
        <ActivityIndicator color={colors.ink2} />
        <Text className="mt-3 font-sans text-body text-ink-2">Saving…</Text>
      </View>
    );
  } else if (!outcome) {
    content = (
      <View>
        <Text className="font-display text-display-md text-ink">Paste a reel link</Text>
        <TextField
          value={input}
          onChangeText={(t) => {
            setInput(t);
            if (pasteError) setPasteError(null);
          }}
          placeholder="instagram.com/reel/…"
          accessibilityLabel="Reel link"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={submitPasted}
          className="mt-4"
          trailing={
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Paste"
              onPress={pasteLink}
              highlightColor={colors.raised}
              containerClassName="-mr-2 ml-2"
              className="min-h-11 justify-center rounded-ctl px-3"
            >
              <Text maxFontSizeMultiplier={1.5} className="font-sans-semibold text-meta text-ink">
                Paste
              </Text>
            </PressableScale>
          }
        />
        {pasteError ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="mt-2 font-sans text-meta text-danger">
            {pasteError}
          </Text>
        ) : null}
        <Button title="Save" onPress={submitPasted} disabled={!input.trim()} className="mt-4" />
        <Button title="Cancel" variant="ghost" onPress={close} className="mt-1" />
      </View>
    );
  } else if (vanished) {
    // Which card it is the server didn't say, so Home is where to find it.
    content = (
      <Message
        icon={<StatusIcon name="info-outline" color={colors.ink2} bg={colors.raised} />}
        title="You saved this already"
        body="It's already in your library. Find it on Home."
      >
        <LinkChip link={link} />
        <Button title="Open Home" onPress={() => leave(() => router.dismissTo("/"))} className="mt-5" />
        <Button title="Close" variant="ghost" onPress={close} className="mt-1" />
      </Message>
    );
  } else if (outcome.kind === "saved" && autoReturn) {
    // "Save and go back": only the confirmation, for the moment before the sheet goes back.
    content = (
      <View>
        <View className="flex-row items-center">
          <PopIn>
            <SavedCheck size={48} />
          </PopIn>
          <Reveal index={1} style={{ marginLeft: 12, flex: 1 }}>
            <Text accessibilityLiveRegion="polite" accessibilityRole="header" className="font-display text-display-lg text-ink">
              Saved
            </Text>
            <Text className="font-sans text-body text-ink-2">It&apos;s on Home now. Lately is writing its card.</Text>
          </Reveal>
        </View>
        <Reveal index={2}>
          <LinkChip link={link} />
        </Reveal>
      </View>
    );
  } else if (outcome.kind === "saved") {
    // It is saved and on Home already; the rest of the sheet is optional and can wait for
    // the card. A small screen scrolls rather than pushing the Done button out of reach.
    content = (
      <ScrollView
        style={{ maxHeight: scrollMax, flexShrink: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center">
          {celebrating ? (
            <Celebrate size={48} />
          ) : (
            <PopIn>
              <SavedCheck size={48} />
            </PopIn>
          )}
          <Reveal index={1} style={{ marginLeft: 12, flex: 1 }}>
            <Text className="font-display text-display-lg text-ink">Saved</Text>
            <Text className="font-sans text-body text-ink-2">It&apos;s on Home now. Lately is writing its card.</Text>
          </Reveal>
        </View>
        <Reveal index={2}>
          <LinkChip link={link} />
          <SaveTracker
            status={progress.status}
            stage={progress.stage}
            slow={progress.slow}
            unreachable={progress.unreachable}
            first={first}
            onOpenCard={openCard}
          />
        </Reveal>
        <Reveal index={3}>
          <Text className="mt-5 font-sans-medium text-body text-ink-2">
            Why are you saving this? <Text className="font-sans text-meta text-ink-3">(optional)</Text>
          </Text>
          <TextField
            value={note}
            onChangeText={(t) => {
              setNote(t);
              if (noteFailed) setNoteFailed(false);
            }}
            placeholder="e.g. cafe to try in June"
            accessibilityLabel="Why you saved it"
            maxLength={500}
            size="lg"
            className="mt-2"
          />
          {noteFailed ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="mt-2 font-sans text-meta text-danger">
              Couldn&apos;t save your note. Try again.
            </Text>
          ) : null}
          {/* Bleeds to the sheet's edges so the last chip peeks out and says "scroll". */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4 mt-3"
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          >
            {QUICK.map((q) => (
              <Chip key={q} label={q} active={note === q} haptic="selection" onPress={() => setNote(q)} />
            ))}
          </ScrollView>
        </Reveal>
        <Reveal index={4}>
          {/* With the card ready, Open card is the main action; until then the note is. */}
          <Button
            title="Save note"
            variant={progress.ready ? "secondary" : "primary"}
            onPress={() => saveNote()}
            disabled={!note.trim()}
            loading={savingNote}
            size="lg"
            className="mt-5"
          />
          <Button title="Done" variant="ghost" onPress={close} className="mt-1" />
        </Reveal>
      </ScrollView>
    );
  } else if (outcome.kind === "deduped") {
    const card = existing.data;
    content = (
      <Message
        icon={<StatusIcon name="info-outline" color={colors.ink2} bg={colors.raised} />}
        title="You saved this already"
        body={card ? `${savedAgo(card.created_at, now)}.` : undefined}
      >
        {existing.isLoading ? (
          <View className="mt-4 flex-row items-center">
            <ActivityIndicator color={colors.ink2} />
            <Text className="ml-3 font-sans text-body text-ink-2">Checking your saves</Text>
          </View>
        ) : null}
        {existing.isError ? (
          <View className="mt-4">
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="font-sans text-body text-ink-2">
              Couldn&apos;t check your saves.
            </Text>
            <Button
              title="Try again"
              variant="secondary"
              onPress={() => existing.refetch()}
              loading={existing.isRefetching}
              className="mt-3"
            />
          </View>
        ) : null}
        {card?.note ? (
          <Animated.View entering={STATE_IN}>
            <Text className="mt-4 rounded-xl bg-raised px-4 py-3 font-sans-italic text-body text-ink-2">{`“${card.note}”`}</Text>
          </Animated.View>
        ) : null}
        <Button title="Open card" onPress={() => leave(() => router.replace(`/reel/${outcome.reelId}`))} className="mt-5" />
        <Button title="Close" variant="ghost" onPress={close} className="mt-1" />
      </Message>
    );
  } else if (outcome.kind === "bad_url") {
    // Only a shared text ends here; a pasted one goes back to the field.
    content = (
      <Message
        icon={<StatusIcon name="error-outline" color={colors.danger} bg={colors.dangerSoft} />}
        title={outcome.notReel ? "That link isn't a reel or post" : "No reel link found"}
        body="Paste or share a link to an Instagram reel or post."
      >
        <Button title="Close" onPress={close} className="mt-5" />
      </Message>
    );
  } else if (outcome.kind === "quota" && billing.proActive) {
    // Google Play says Pro is on and the server still doesn't (the save already synced and retried
    // once): no upsell for someone who has paid. Trying again syncs and retries once more.
    content = (
      <Message icon={<StatusIcon name="schedule" color={colors.ink2} bg={colors.raised} />} title="Pro is turning on" body={PRO_CONFIRMING}>
        <Button title="Try again" onPress={() => save(savedText)} className="mt-5" />
        <Button title="Close" variant="ghost" onPress={close} className="mt-1" />
      </Message>
    );
  } else if (outcome.kind === "quota") {
    const limit = me.data?.saves_limit ?? 20;
    content = (
      <Message icon={<StatusIcon name="lock-outline" color={colors.ink2} bg={colors.raised} />} title={`You've used all ${limit} free saves this month`}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Free saves used this month"
          accessibilityValue={{ min: 0, max: limit, now: limit }}
          className="mt-4 h-2 overflow-hidden rounded-full bg-raised"
        >
          <View className="h-2 w-full rounded-full bg-accent" />
        </View>
        <Text className="mt-1 self-end font-sans-semibold text-meta text-ink-2">{`${limit}/${limit}`}</Text>
        <Text className="mt-2 font-sans text-body text-ink-2">
          {me.data ? `Saves reset on ${shortDate(me.data.resets_on)}. Pro removes the monthly cap.` : "Pro removes the monthly cap."}
        </Text>
        {/* Replaces this sheet: closing the paywall goes back to where the save started. The reel
            goes along, so the paywall can save it once Pro is on. */}
        <Button
          title="Upgrade to Pro"
          onPress={() => router.replace({ pathname: "/pro", params: fromShare ? { text: savedText, from } : { text: savedText } })}
          className="mt-5"
        />
        <Button title="Not now" variant="ghost" onPress={close} className="mt-1" />
      </Message>
    );
  } else if (outcome.kind === "rate_limited") {
    content = (
      <Message
        icon={<StatusIcon name="schedule" color={colors.ink2} bg={colors.raised} />}
        title="That's a lot of saves at once"
        body="Try again in a minute."
      >
        <Button title="Close" onPress={close} className="mt-5" />
      </Message>
    );
  } else if (outcome.kind === "queued") {
    content = (
      <Message
        icon={<StatusIcon name="cloud-upload" color={colors.ink2} bg={colors.raised} />}
        title="Waiting to save"
        body={QUEUED_BODY[outcome.reason]}
      >
        <LinkChip link={link} />
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
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1 justify-end">
      {/* Only the scrim: a shared reel opens over whatever app it came from, and nothing of Lately's own is faked behind it. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: shared ? colors.scrim : colors.backdrop }, backdropStyle]}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          focusable={false}
          accessibilityLabel="Close"
          onPress={requestClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <SheetPanel motion={motion} onDismiss={requestClose} layout={SHEET_RESIZE}>
        <Animated.View key={phase} entering={phase === "busy" ? undefined : STATE_IN}>
          {content}
        </Animated.View>
      </SheetPanel>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  statusIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
