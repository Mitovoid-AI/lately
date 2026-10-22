import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, type Category, type ReelStatus, type Save, type SaveStage } from "../api/contract";
import { useApi } from "../api/index";

const PAGE = 25;

/** How often views re-ask the API while a card they show was saved in the last 2 minutes. */
export const PENDING_FAST_MS = 4000;
export const PENDING_POLL_MS = PENDING_FAST_MS;
/** After 2 minutes a card is slow to arrive: ask every 30 s instead. */
export const PENDING_SLOW_MS = 30_000;
const FAST_FOR_MS = 2 * 60_000;
/** After 15 minutes the job has most likely died: stop asking (the card offers Try again). */
const POLL_FOR_MS = 15 * 60_000;
/** A card still processing after 10 minutes offers Try again (POST /retries accepts it). */
export const STALE_PENDING_MS = 10 * 60_000;

type PendingInfo = Pick<Save, "id" | "status" | "created_at">;

// When this session retried a save: a retried card counts its processing time from then,
// not from when it was first saved.
const retriedAt = new Map<string, number>();

export function markRetried(id: string, at = Date.now()) {
  retriedAt.set(id, at);
}

function pendingAge(s: PendingInfo, now: number): number {
  const since = Math.max(Date.parse(s.created_at) || 0, retriedAt.get(s.id) ?? 0);
  return now - since;
}

/** A pending save that has been processing long enough that its job probably died. */
export const isStalePending = (s: PendingInfo, now = Date.now()) =>
  s.status === "pending" && pendingAge(s, now) > STALE_PENDING_MS;

/**
 * A refetchInterval for any query whose data holds saves: every 4 s while a pending save is
 * under 2 minutes old, every 30 s until it is 15 minutes old, then not at all.
 */
export function pollWhilePending(saves: readonly PendingInfo[] | undefined, now = Date.now()): number | false {
  let youngest = Infinity;
  for (const s of saves ?? []) {
    if (s.status === "pending") youngest = Math.min(youngest, pendingAge(s, now));
  }
  if (youngest < FAST_FOR_MS) return PENDING_FAST_MS;
  if (youngest < POLL_FOR_MS) return PENDING_SLOW_MS;
  return false;
}

/**
 * The Home list (optionally one category): keyset pages, refreshed every 4 s while any
 * card is still processing. Every list lives under the ["saves"] key prefix.
 */
export function useSaves(category?: Category) {
  const api = useApi();
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    // Switching to a category shows the matching cards already loaded under "all" straight
    // away (no skeleton flash) while its own request runs.
    placeholderData: () => {
      if (!category) return undefined;
      const all = queryClient.getQueryData<InfiniteData<Save[], string | undefined>>(["saves", "all"]);
      if (!all) return undefined;
      return { pages: [all.pages.flat().filter((s) => s.category === category)], pageParams: [undefined] };
    },
    queryKey: ["saves", category ?? "all"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listSaves({ before: pageParam, limit: PAGE, ...(category ? { category } : {}) }),
    getNextPageParam: (last: Save[]) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    refetchInterval: (query) => pollWhilePending(query.state.data?.pages.flat()),
  });
  const saves = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  return {
    saves,
    isLoading: q.isLoading,
    isError: q.isError && !q.data,
    hasNextPage: !!q.hasNextPage,
    fetchNextPage: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    },
    refetch: q.refetch,
    isRefetching: q.isRefetching && !q.isFetchingNextPage,
  };
}

/** How often the save sheet asks the server how a card is coming along. */
export const PROGRESS_POLL_MS = 2000;
/** After this long the card is slow: say so, and ask less often. */
export const PROGRESS_EASE_AFTER_MS = 90_000;
export const PROGRESS_SLOW_POLL_MS = 10_000;
/** After this long the sheet stops asking (Home keeps polling, and the card offers Try again). */
export const PROGRESS_GIVE_UP_MS = 5 * 60_000;

/**
 * Follows one save while its card is made: asks `getSave` every 2 s while it is pending, every
 * 10 s once it has taken 90 s, and stops when it is done, after 5 minutes, when the save is
 * gone, when `active` turns false (the sheet is closing) and when the screen unmounts. The
 * `stage` is the server's real step; there is no percentage.
 */
export function useSaveProgress(reelId: string | null, active = true) {
  const api = useApi();
  const queryClient = useQueryClient();
  const on = !!reelId && active;
  const startedAt = useRef<number | null>(null);
  const [slowFor, setSlowFor] = useState<string | null>(null);

  const q = useQuery({
    // The card's own key, so opening it a moment later starts from what the sheet already knows.
    queryKey: ["save", reelId],
    queryFn: () => api.getSave(reelId as string),
    enabled: on,
    staleTime: 0,
    refetchInterval: (query) => {
      if (query.state.data && query.state.data.status !== "pending") return false;
      if (query.state.error instanceof ApiError && query.state.error.code === "NOT_FOUND") return false;
      const since = startedAt.current === null ? 0 : Date.now() - startedAt.current;
      if (since >= PROGRESS_GIVE_UP_MS) return false;
      return since >= PROGRESS_EASE_AFTER_MS ? PROGRESS_SLOW_POLL_MS : PROGRESS_POLL_MS;
    },
  });

  const dataStatus = q.data?.status;
  const status: ReelStatus = dataStatus ?? "pending";
  const ready = dataStatus !== undefined && dataStatus !== "pending";

  // The clock for "slow" and "give up" starts when this save starts being followed.
  useEffect(() => {
    if (!on || ready) return;
    startedAt.current = Date.now();
    const id = setTimeout(() => setSlowFor(reelId), PROGRESS_EASE_AFTER_MS);
    return () => clearTimeout(id);
  }, [on, ready, reelId]);

  // A card that was pending when the sheet looked turned into a card: Home shows it now.
  const sawPending = useRef(false);
  useEffect(() => {
    if (dataStatus === "pending") sawPending.current = true;
    else if (dataStatus && sawPending.current) {
      sawPending.current = false;
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  }, [dataStatus, queryClient]);

  const stage: SaveStage | null = status === "pending" ? (q.data?.stage ?? null) : null;
  return {
    status,
    stage,
    ready,
    slow: !ready && slowFor !== null && slowFor === reelId,
    /** The last check failed (offline, server trouble); the card keeps being made regardless. */
    unreachable: q.isError && !ready,
  };
}

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ["me"], queryFn: () => api.getMe() });
}
