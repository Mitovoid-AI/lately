import { MutationCache, QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";

import { ApiError } from "../api/contract";

const isUnauthorized = (e: unknown) => e instanceof ApiError && e.code === "UNAUTHORIZED";

/** Errors a retry cannot fix: the session is gone or the thing isn't there. */
function retryable(e: unknown) {
  return !(e instanceof ApiError && (e.code === "UNAUTHORIZED" || e.code === "NOT_FOUND" || e.code === "BAD_URL"));
}

/**
 * The app's query client. Any request that still ends in UNAUTHORIZED (the HTTP client has
 * already tried a token refresh) means the session is dead: `onUnauthorized` signs the user out.
 */
export function createAppQueryClient(onUnauthorized: () => void): QueryClient {
  const onError = (e: unknown) => {
    if (isUnauthorized(e)) onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: (count, e) => retryable(e) && count < 2, staleTime: 30_000 },
      mutations: { retry: 0 },
    },
  });
}

/** Every query that shows saves: list, detail, account counts, stacks, curated, search. */
export const SAVE_VIEW_KEYS: QueryKey[] = [["saves"], ["save"], ["me"], ["stacks"], ["stack"], ["curated"], ["search"]];

/** After a save changes (created, edited, deleted, retried), mark every view of saves stale. */
export function refreshSaveViews(client: QueryClient): Promise<void> {
  return Promise.all(SAVE_VIEW_KEYS.map((queryKey) => client.invalidateQueries({ queryKey }))).then(() => undefined);
}
