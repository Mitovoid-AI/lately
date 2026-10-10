import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Category, Save } from "../api/contract";
import { useApi } from "../api/index";

const PAGE = 25;

/** How often views re-ask the API while a card they show is still processing. */
export const PENDING_POLL_MS = 4000;

/** A refetchInterval for any query whose data holds saves: poll while one is pending, stop when none is. */
export const pollWhilePending = (saves: readonly Pick<Save, "status">[] | undefined) =>
  saves?.some((s) => s.status === "pending") ? PENDING_POLL_MS : false;

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
