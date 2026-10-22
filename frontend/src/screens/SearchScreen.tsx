import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FlatList, ScrollView, Text, View, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, type SearchHit } from "../api/contract";
import { useApi } from "../api/index";
import { ErrorState } from "../components/ErrorState";
import { IconButton } from "../components/motion/IconButton";
import { Reveal, useEntranceWindow } from "../components/motion/Reveal";
import { BestMatch, CompactRow } from "../components/search/ResultRows";
import { SearchField } from "../components/search/SearchField";
import { IdleState, NoResults, SearchSkeleton } from "../components/search/SearchStates";
import { useIsPushed } from "../components/search/useIsPushed";
import { useSearchExamples } from "../components/search/useSearchExamples";
import { pollWhilePending } from "../hooks/useSaves";
import { useNow } from "../hooks/useNow";
import { countOf } from "../lib/counts";
import { goBack } from "../lib/navigation";
import { clearRecent, loadRecent, pushRecent } from "../lib/recent";
import { deviceStore } from "../lib/storage";
import { useTheme } from "../theme/ThemeProvider";

/** The widest the content gets (tablets, web); phones fill the width. */
const COLUMN = { maxWidth: 640, width: "100%", alignSelf: "center" } as const;

/** The short states (empty query, no results) scroll too: with the keyboard up they can outgrow the screen. */
function Scroll({ children, bottom }: { children: ReactNode; bottom: number }) {
  return (
    <ScrollView
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottom }}
    >
      {children}
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="font-sans-semibold text-meta text-ink-2">{children}</Text>;
}

/**
 * Search, a tab: type what you remember and the best match comes first as a large card with the
 * reasons it matched, then the other saves as compact rows. The field takes focus when the tab
 * does (and only when it is empty, so coming back to results does not throw the keyboard up).
 * Back shows only when Search was pushed over another screen, not when it is the tab root.
 */
export function SearchScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const initial = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const pushed = useIsPushed();
  const examples = useSearchExamples();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState(initial);
  const [debounced, setDebounced] = useState(initial.trim());
  const [recent, setRecent] = useState<string[]>([]);

  // The tab stays mounted, so a later "/search?q=..." arrives as a changed param: apply it.
  const [appliedParam, setAppliedParam] = useState(initial);
  if (initial !== appliedParam) {
    setAppliedParam(initial);
    setQuery(initial);
    setDebounced(initial.trim());
  }

  useEffect(() => {
    loadRecent(deviceStore).then(setRecent);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Read at tap and focus time, so callbacks (and every row) don't change on each keystroke.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Focus the field whenever the tab gains focus, unless results are already on screen; let go of
  // the keyboard when the tab loses focus (switching tabs, opening a card).
  useFocusEffect(
    useCallback(() => {
      const focusLater = queryRef.current.trim().length === 0;
      const t = focusLater ? setTimeout(() => inputRef.current?.focus(), 60) : undefined;
      return () => {
        if (t) clearTimeout(t);
        inputRef.current?.blur();
      };
    }, []),
  );

  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 0,
    refetchInterval: (q) => pollWhilePending(q.state.data?.map((h) => h.save)),
  });

  const remember = useCallback(async (q: string) => setRecent(await pushRecent(deviceStore, q)), []);
  const open = useCallback(
    (hit: SearchHit) => {
      remember(queryRef.current);
      router.push(`/reel/${hit.save.id}`);
    },
    [remember, router],
  );
  const pick = useCallback((q: string) => setQuery(q), []);
  const forgetRecent = useCallback(async () => {
    await clearRecent(deviceStore);
    setRecent([]);
  }, []);

  const hits = results.data ?? [];
  const best = hits[0];
  const rest = hits.slice(1);
  const blank = query.trim().length === 0;
  const searching = results.isLoading || debounced !== query.trim();
  const offline = results.error instanceof ApiError && results.error.code === "NETWORK";
  // Each new set of results staggers in; rows scrolled into view later just appear.
  const entrance = useEntranceWindow(debounced, !searching);

  const renderItem = useCallback(
    ({ item, index }: { item: SearchHit; index: number }) => (
      <Reveal index={index + 2} enabled={entrance}>
        <CompactRow hit={item} now={now} onOpen={open} />
      </Reveal>
    ),
    [entrance, now, open],
  );

  // A tab's bar already clears the home indicator; a pushed screen has to do it itself.
  const bottomPad = (pushed ? insets.bottom : 0) + 24;

  let body: ReactNode;
  if (blank) {
    body = (
      <Scroll bottom={bottomPad}>
        <IdleState recent={recent} examples={examples} onPick={pick} onClearRecent={forgetRecent} />
      </Scroll>
    );
  } else if (searching) {
    body = <SearchSkeleton />;
  } else if (results.isError && !results.data) {
    body = offline ? (
      <ErrorState
        title="You're offline"
        body="Search needs a connection. Try again when you're back online."
        onRetry={() => results.refetch()}
        retrying={results.isRefetching}
      />
    ) : (
      <ErrorState
        title="Couldn't search right now"
        body="Lately's search isn't responding. Try again in a minute."
        onRetry={() => results.refetch()}
        retrying={results.isRefetching}
      />
    );
  } else if (!best) {
    body = (
      <Scroll bottom={bottomPad}>
        <NoResults query={query.trim()} examples={examples} onPick={pick} />
      </Scroll>
    );
  } else {
    body = (
      <FlatList
        data={rest}
        keyExtractor={(h) => `${debounced}:${h.save.id}`}
        contentContainerStyle={{ ...COLUMN, paddingHorizontal: 16, paddingBottom: bottomPad }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="pt-3">
            <Reveal index={0} enabled={entrance}>
              <View className="flex-row items-baseline justify-between">
                <SectionLabel>Best match</SectionLabel>
                {/* A live region: a screen reader says how many came back when the results change. */}
                <Text accessibilityLiveRegion="polite" className="font-sans text-meta text-ink-2">
                  {`${countOf(hits.length, "save")} found`}
                </Text>
              </View>
              <View className="mt-3">
                <BestMatch hit={best} now={now} onOpen={open} />
              </View>
            </Reveal>
            {rest.length ? (
              <Reveal index={1} enabled={entrance} style={{ marginTop: 24 }}>
                <SectionLabel>Also from your saves</SectionLabel>
              </Reveal>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={Separator}
        renderItem={renderItem}
      />
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="w-full max-w-[640px] flex-row items-center self-center pb-3 pr-4 pt-2" style={{ paddingLeft: pushed ? 4 : 16 }}>
        {pushed ? (
          <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={() => goBack(router)} />
        ) : null}
        <SearchField
          value={query}
          onChangeText={setQuery}
          onSubmit={() => remember(query)}
          onClear={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          placeholder="Search what you remember…"
          inputRef={inputRef}
        />
      </View>
      {body}
    </View>
  );
}

function Separator() {
  return <View className="h-px bg-hairline" />;
}
