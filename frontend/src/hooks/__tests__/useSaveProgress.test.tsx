import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ApiError, type LatelyApi, type SaveDetail } from "../../api/contract";
import { ApiProvider } from "../../api/index";
import { NOW } from "../../test/fixtures";
import { demoApi } from "../../test/render";
import {
  PROGRESS_EASE_AFTER_MS,
  PROGRESS_GIVE_UP_MS,
  PROGRESS_POLL_MS,
  PROGRESS_SLOW_POLL_MS,
  useSaveProgress,
} from "../useSaves";

const BASE: SaveDetail = {
  id: "r1",
  source_url: "https://www.instagram.com/reel/abc/",
  shortcode: "abc",
  status: "pending",
  note: null,
  created_at: "2026-10-04T12:00:00Z",
  title: null,
  caption: null,
  category: null,
  thumbnail_url: null,
  creator: null,
  channel: "app_share",
  stage: "resolve",
  summary: null,
  steps: null,
  tags: null,
  places: [],
  media_status: "pending",
};

type Reply = Partial<SaveDetail> | Error;

/** The hook against a getSave that answers from a script (the last reply repeats). */
async function setup(replies: Reply[], props: { id: string | null; active: boolean } = { id: "r1", active: true }) {
  const queue = [...replies];
  const getSave = jest.fn(async (_id: string): Promise<SaveDetail> => {
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) throw next;
    return { ...BASE, ...next };
  });
  const api: LatelyApi = { ...demoApi(), getSave };
  // gcTime Infinity: no garbage-collection timers left running after a test.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>{children}</ApiProvider>
    </QueryClientProvider>
  );
  const hook = await renderHook((p: { id: string | null; active: boolean }) => useSaveProgress(p.id, p.active), {
    wrapper,
    initialProps: props,
  });
  return { getSave, client, ...hook };
}

/** Moves the fake clock; every check that falls due goes out and answers before this returns. */
const tick = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

test("asks every 2 s while the card is pending, follows its stage, and stops when it is done", async () => {
  const { getSave, result } = await setup([{ stage: "resolve" }, { stage: "transcribe" }, { status: "enriched", stage: null }]);
  await waitFor(() => expect(result.current.stage).toBe("resolve"));
  expect(getSave).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({ status: "pending", ready: false, slow: false, unreachable: false });

  await tick(PROGRESS_POLL_MS);
  await waitFor(() => expect(result.current.stage).toBe("transcribe"));
  expect(getSave).toHaveBeenCalledTimes(2);

  await tick(PROGRESS_POLL_MS);
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current).toMatchObject({ status: "enriched", stage: null });
  expect(getSave).toHaveBeenCalledTimes(3);

  await tick(60_000);
  expect(getSave).toHaveBeenCalledTimes(3);
});

test("a partial card is finished too", async () => {
  const { result } = await setup([{ status: "partial", stage: null }]);
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.status).toBe("partial");
});

test("with no save yet it asks nothing", async () => {
  const { getSave } = await setup([{}], { id: null, active: true });
  await tick(60_000);
  expect(getSave).not.toHaveBeenCalled();
});

test("stops asking when the sheet starts closing", async () => {
  const { getSave, rerender } = await setup([{}]);
  await waitFor(() => expect(getSave).toHaveBeenCalledTimes(1));
  await rerender({ id: "r1", active: false });
  await tick(60_000);
  expect(getSave).toHaveBeenCalledTimes(1);
});

test("stops asking when the screen unmounts", async () => {
  const { getSave, unmount } = await setup([{}]);
  await waitFor(() => expect(getSave).toHaveBeenCalledTimes(1));
  await unmount();
  await tick(60_000);
  expect(getSave).toHaveBeenCalledTimes(1);
});

test("after 90 s it says the card is slow and asks every 10 s instead of every 2 s", async () => {
  const { getSave, result } = await setup([{}]);
  await waitFor(() => expect(result.current.stage).toBe("resolve"));
  expect(result.current.slow).toBe(false);
  for (let i = 0; i < PROGRESS_EASE_AFTER_MS / PROGRESS_POLL_MS; i++) await tick(PROGRESS_POLL_MS);
  await waitFor(() => expect(result.current.slow).toBe(true));

  getSave.mockClear();
  for (let i = 0; i < 3; i++) await tick(PROGRESS_SLOW_POLL_MS);
  expect(getSave).toHaveBeenCalledTimes(3);
});

test("after 5 minutes it gives up (the Library keeps watching the card)", async () => {
  const { getSave, result } = await setup([{}]);
  await waitFor(() => expect(result.current.stage).toBe("resolve"));
  for (let t = 0; t < PROGRESS_EASE_AFTER_MS; t += PROGRESS_POLL_MS) await tick(PROGRESS_POLL_MS);
  for (let t = PROGRESS_EASE_AFTER_MS; t < PROGRESS_GIVE_UP_MS + PROGRESS_SLOW_POLL_MS; t += PROGRESS_SLOW_POLL_MS) {
    await tick(PROGRESS_SLOW_POLL_MS);
  }
  getSave.mockClear();
  await tick(60_000);
  expect(getSave).not.toHaveBeenCalled();
});

test("a failed check reads as unreachable, keeps trying, and recovers", async () => {
  const { result } = await setup([{ stage: "fetch" }, new ApiError("NETWORK", 0), { stage: "vision" }]);
  await waitFor(() => expect(result.current.stage).toBe("fetch"));
  await tick(PROGRESS_POLL_MS);
  await waitFor(() => expect(result.current.unreachable).toBe(true));
  // What was known stays on screen while the check is failing.
  expect(result.current.stage).toBe("fetch");
  await tick(PROGRESS_POLL_MS);
  await waitFor(() => expect(result.current.stage).toBe("vision"));
  expect(result.current.unreachable).toBe(false);
});

test("a save that is gone is not asked about again", async () => {
  const { getSave } = await setup([new ApiError("NOT_FOUND", 404)]);
  await waitFor(() => expect(getSave).toHaveBeenCalledTimes(1));
  await tick(60_000);
  expect(getSave).toHaveBeenCalledTimes(1);
});

test("a card that turns ready refreshes the Library lists once", async () => {
  const { client, result } = await setup([{ stage: "finalize" }, { status: "enriched", stage: null }]);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await waitFor(() => expect(result.current.stage).toBe("finalize"));
  expect(invalidate).not.toHaveBeenCalled();
  await tick(PROGRESS_POLL_MS);
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["saves"] });
});
