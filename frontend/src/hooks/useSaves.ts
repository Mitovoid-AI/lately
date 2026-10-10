import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Category, Save } from "../api/contract";
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
 * The Library list (optionally one category): keyset pages, refreshed every 4 s while any
 * card is still processing. Every list lives under the ["saves"] key prefix.
 */
export function useSaves(category?: Category) {
  const api = useApi();
  const q = useInfiniteQuery({
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

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ["me"], queryFn: () => api.getMe() });
}
