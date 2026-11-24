import { useQuery } from "@tanstack/react-query";

import type { InstagramLink } from "../../api/contract";
import { useApi } from "../../api/index";

/** One cache entry for the Instagram connection: Account's row, Help and the /instagram screen share it. */
export const INSTAGRAM_KEY = ["instagram"];

/** A code is on its way: made, not yet seen by the server, not expired. */
export function codeIsLive(link: InstagramLink | undefined, now: number): boolean {
  return !!link && !link.linked && !!link.code && !!link.code_expires_at && Date.parse(link.code_expires_at) > now;
}

/** GET /me/instagram; with `poll`, asks again every `everyMs` for as long as `while` holds for the last answer. */
export function useInstagramLink(poll?: { everyMs: number; while: (link: InstagramLink | undefined) => boolean }) {
  const api = useApi();
  return useQuery({
    queryKey: INSTAGRAM_KEY,
    queryFn: () => api.getInstagramLink(),
    refetchInterval: poll ? (q) => (poll.while(q.state.data) ? poll.everyMs : false) : false,
  });
}
