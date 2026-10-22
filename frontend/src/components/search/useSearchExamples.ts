import { useMemo } from "react";

import { config } from "../../config";
import { useSaves } from "../../hooks/useSaves";
import { examplesFromSaves, SEARCH_EXAMPLES } from "../../lib/searchExamples";

/**
 * The example chips for Search. In demo mode the fixed list (each one finds a demo card); in the
 * live app a search the person could run on their own saves, from the same list Home shows (one
 * shared request). Empty until there are at least three to offer, and the chips then stay hidden.
 */
export function useSearchExamples(mode: "demo" | "live" = config.apiMode): readonly string[] {
  const { saves } = useSaves();
  return useMemo(() => (mode === "demo" ? SEARCH_EXAMPLES : examplesFromSaves(saves)), [mode, saves]);
}
