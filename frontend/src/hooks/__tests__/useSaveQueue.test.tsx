import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AppState, Pressable, Text } from "react-native";

import { ApiError } from "../../api/contract";
import { enqueueSave, queueKey, readQueue } from "../../lib/saveQueue";
import { createMemoryStore } from "../../test/memoryStore";
import { demoApi, renderWithProviders } from "../../test/render";
import { useSaveQueue } from "../useSaveQueue";

const KEY = queueKey("demo-user");
const LINK = "https://www.instagram.com/reel/QUEUED1/";

function Probe() {
  const { queued, enqueue } = useSaveQueue();
  return (
    <>
      <Text>{`queued: ${queued.length}`}</Text>
      <Pressable onPress={() => enqueue(LINK)}>
        <Text>enqueue</Text>
      </Pressable>
    </>
  );
}

test("a queue left from last time is sent on sign-in and refreshes the library", async () => {
  const queueStore = createMemoryStore();
  await enqueueSave(queueStore, KEY, LINK);
  const api = demoApi();
  const createSave = jest.spyOn(api, "createSave");
  const { client } = await renderWithProviders(<Probe />, { api, queueStore });
  client.setQueryData(["saves", "all"], { cached: true });
  await waitFor(() => expect(createSave).toHaveBeenCalledWith(LINK));
  expect(await screen.findByText("queued: 0")).toBeTruthy();
  expect(await screen.findByText("Saved 1 reel you shared offline")).toBeTruthy();
  expect(await readQueue(queueStore, KEY)).toEqual([]);
});

test("still offline: the save stays queued, and coming back to the app retries it", async () => {
  const queueStore = createMemoryStore();
  await enqueueSave(queueStore, KEY, LINK);
  const api = demoApi();
  const createSave = jest
    .spyOn(api, "createSave")
    .mockRejectedValueOnce(new ApiError("NETWORK", 0))
    .mockResolvedValueOnce({ reel_id: "r1", deduped: false, status: "pending" });
  // React Native's jest setup makes AppState.addEventListener a mock: replay its listeners.
  const addListener = AppState.addEventListener as unknown as jest.Mock;
  const before = addListener.mock.calls.length;
  await renderWithProviders(<Probe />, { api, queueStore });
  const listeners = addListener.mock.calls
    .slice(before)
    .filter(([type]) => type === "change")
    .map(([, fn]) => fn as (s: string) => void);
  await waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("queued: 1")).toBeTruthy();
  await act(async () => listeners.forEach((fn) => fn("active")));
  await waitFor(() => expect(createSave).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("queued: 0")).toBeTruthy();
});

test("a waiting queue is retried on a timer", async () => {
  jest.useFakeTimers({ advanceTimers: true });
  try {
    const queueStore = createMemoryStore();
    const api = demoApi();
    const createSave = jest.spyOn(api, "createSave").mockRejectedValue(new ApiError("NETWORK", 0));
    await renderWithProviders(<Probe />, { api, queueStore });
    await fireEvent.press(screen.getByText("enqueue"));
    expect(await screen.findByText("queued: 1")).toBeTruthy();
    expect(createSave).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
  } finally {
    jest.useRealTimers();
  }
});

test("signed out, nothing is queued or sent", async () => {
  const queueStore = createMemoryStore();
  await renderWithProviders(<Probe />, { queueStore, auth: { status: "signed-out", user: null } });
  await fireEvent.press(screen.getByText("enqueue"));
  expect(screen.getByText("queued: 0")).toBeTruthy();
  expect(await readQueue(queueStore, KEY)).toEqual([]);
});
