import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { DEFAULT_PREFERENCES, type Preferences } from "../api/contract";
import { useApi } from "../api/index";
import { useToast } from "../components/Toast";

const KEY = ["prefs"];

/** What the server last confirmed, per query client: the base that failed or pending changes are laid over. */
const confirmed = new WeakMap<QueryClient, Preferences>();

/** The confirmed preferences with every change still on its way applied in order (`except` one that just settled). */
function withPending(client: QueryClient, base: Preferences, except?: Partial<Preferences>): Preferences {
  return client
    .getMutationCache()
    .findAll({ mutationKey: KEY, status: "pending" })
    .map((m) => m.state.variables as Partial<Preferences>)
    .filter((p) => p !== except)
    .reduce<Preferences>((acc, p) => ({ ...acc, ...p }), base);
}

const FONTS: Record<Preferences["reading_font"], string> = {
  newsreader: "Newsreader_400Regular",
  inter: "Inter_400Regular",
  lora: "Lora_400Regular",
};

/**
 * Reading/appearance preferences; updates apply immediately (optimistic). `loaded` is false
 * while `prefs` are still the defaults standing in for the account's own: then `update` does
 * nothing, so a default is never saved (or put on screen as the theme) as if it were chosen.
 * Changes go to the server one at a time, in order; a reply only lands once no later change is
 * waiting (quick taps end on the last choice, without flicker), and a change that fails is
 * rolled back and said in a toast.
 */
export function usePreferences() {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const saved = await api.getPreferences();
      confirmed.set(client, saved);
      return withPending(client, saved);
    },
  });
  const mutation = useMutation({
    mutationKey: KEY,
    scope: { id: "prefs" },
    mutationFn: (p: Partial<Preferences>) => api.updatePreferences(p),
    // At once, even while an earlier change is still on its way. A load in flight is cancelled
    // first (and waited for: its revert must not land on top of this change).
    onMutate: async (p) => {
      await client.cancelQueries({ queryKey: KEY });
      client.setQueryData<Preferences>(KEY, (old) => ({ ...DEFAULT_PREFERENCES, ...old, ...p }));
    },
    onSuccess: (saved, p) => {
      confirmed.set(client, saved);
      client.setQueryData(KEY, withPending(client, saved, p));
    },
    onError: (_e, p) => {
      const base = confirmed.get(client);
      if (base) client.setQueryData(KEY, withPending(client, base, p));
      toast.show("Couldn't save that change. Try again.");
    },
  });
  const { mutate } = mutation;
  const loaded = query.data !== undefined;
  const update = useCallback(
    (p: Partial<Preferences>) => {
      if (loaded) mutate(p);
    },
    [mutate, loaded],
  );
  return {
    prefs: query.data ?? DEFAULT_PREFERENCES,
    loaded,
    update,
    /** Not loaded, and the last try failed (offline, server down). */
    failed: !loaded && query.isError,
    retry: query.refetch,
    retrying: query.isFetching,
  };
}

/** Text style for summaries, notes and captions (reading font + text size). */
export function useReadingStyle() {
  const { prefs } = usePreferences();
  return {
    fontFamily: FONTS[prefs.reading_font],
    fontSize: prefs.text_size,
    lineHeight: Math.round(prefs.text_size * 1.5),
  };
}
