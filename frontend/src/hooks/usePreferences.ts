import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { DEFAULT_PREFERENCES, type Preferences } from "../api/contract";
import { useApi } from "../api/index";

const KEY = ["prefs"];

const FONTS: Record<Preferences["reading_font"], string> = {
  newsreader: "Newsreader_400Regular",
  inter: "Inter_400Regular",
  lora: "Lora_400Regular",
};

/** Reading/appearance preferences; updates apply immediately (optimistic). */
export function usePreferences() {
  const api = useApi();
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.getPreferences() });
  const mutation = useMutation({
    mutationFn: (p: Partial<Preferences>) => api.updatePreferences(p),
    onSuccess: (saved) => client.setQueryData(KEY, saved),
  });
  const { mutate } = mutation;
  const update = useCallback(
    (p: Partial<Preferences>) => {
      client.setQueryData<Preferences>(KEY, (old) => ({ ...DEFAULT_PREFERENCES, ...old, ...p }));
      mutate(p);
    },
    [client, mutate],
  );
  return { prefs: query.data ?? DEFAULT_PREFERENCES, update };
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
