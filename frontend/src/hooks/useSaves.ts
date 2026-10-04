import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Save } from "../api/contract";
import { useApi } from "../api/index";

const PAGE = 25;

/** The Library list: keyset pages, refreshed every 4 s while any card is still processing. */
export function useSaves() {
  const api = useApi();
  const q = useInfiniteQuery({
    queryKey: ["saves"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listSaves({ before: pageParam, limit: PAGE }),
    getNextPageParam: (last: Save[]) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.some((s) => s.status === "pending")) ? 4000 : false,
  });
  const saves = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  return {
    saves,
    isLoading: q.isLoading,
    isError: q.isError,
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
