import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError, type ExportDownload, type LatelyApi } from "../../api/contract";
import { ApiProvider } from "../../api/index";
import { ToastProvider } from "../../components/Toast";
import { demoApi } from "../../test/render";
import { useExport } from "../useExport";

const mockShare = jest.fn(async (_name: string, _json: string) => {});
jest.mock("../../lib/exportFile", () => ({ shareExportFile: (n: string, j: string) => mockShare(n, j) }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const READY: ExportDownload = { status: "ready", filename: "lately-export-20261010.json", json: "{}" };
const POLL_MS = 1000;

/**
 * The hook with a scripted GET /me/export (one answer per call, the last one repeating). Polling
 * runs on Jest's fake clock: nothing happens between polls until the test moves time on.
 */
async function setup(downloads: (ExportDownload | Error)[], o: { giveUpMs?: number; client?: QueryClient } = {}) {
  const queue = [...downloads];
  const api: LatelyApi = {
    ...demoApi(),
    requestExport: jest.fn(async () => ({ status: "queued" as const })),
    downloadExport: jest.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const client = o.client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <ApiProvider api={api}>
          <ToastProvider>{children}</ToastProvider>
        </ApiProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const hook = await renderHook(() => useExport({ pollMs: POLL_MS, giveUpMs: o.giveUpMs ?? 60_000 }), { wrapper });
  return { api, client, ...hook };
}

/** Moves the fake clock; a poll that falls due goes out and answers before this returns. */
const tick = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test("requests an export, polls while it is queued, then is ready", async () => {
  const { api, result } = await setup([{ status: "queued" }, { status: "queued" }, READY]);
  expect(result.current.phase).toBe("idle");
  await act(() => result.current.start());
  expect(result.current.phase).toBe("preparing");
  expect(api.downloadExport).toHaveBeenCalledTimes(1);
  await tick(POLL_MS);
  expect(api.downloadExport).toHaveBeenCalledTimes(2);
  expect(result.current.phase).toBe("preparing");
  await tick(POLL_MS);
  expect(result.current.phase).toBe("ready");
  expect(api.requestExport).toHaveBeenCalledTimes(1);
  expect(api.downloadExport).toHaveBeenCalledTimes(3);
});

// This used to race: polls 5 ms apart on the real clock, so on a busy machine the ready answer
// landed while act() was still settling, before the "not yet" check. On the fake clock the next
// poll waits until the test moves time.
test("a screen reader is told when the archive is ready, once", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  const { result } = await setup([{ status: "queued" }, READY]);
  await act(() => result.current.start());
  expect(announce).not.toHaveBeenCalled();
  await tick(POLL_MS);
  expect(result.current.phase).toBe("ready");
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith("Your archive is ready");
  // Shown too: the person may be on another screen by now.
  expect(screen.getByText("Your archive is ready")).toBeTruthy();
  announce.mockRestore();
});

test("download writes the file and opens the share sheet", async () => {
  const { result } = await setup([READY]);
  await act(() => result.current.start());
  expect(result.current.phase).toBe("ready");
  await act(() => result.current.download());
  expect(mockShare).toHaveBeenCalledWith("lately-export-20261010.json", "{}");
  expect(result.current.phase).toBe("ready");
});

test("gives up after the time limit and goes back to idle", async () => {
  const { result } = await setup([{ status: "queued" }], { giveUpMs: 3 * POLL_MS });
  await act(() => result.current.start());
  expect(result.current.phase).toBe("preparing");
  await tick(3 * POLL_MS);
  expect(result.current.phase).toBe("idle");
  expect(screen.getByText("Your archive is taking a while. Try again in a few minutes.")).toBeTruthy();
});

test("a network blip while polling keeps polling", async () => {
  const { result } = await setup([new ApiError("NETWORK", 0), READY]);
  await act(() => result.current.start());
  expect(result.current.phase).toBe("preparing");
  await tick(POLL_MS);
  expect(result.current.phase).toBe("ready");
});

test("an archive the server couldn't build says so and goes back to idle", async () => {
  const { api, result } = await setup([{ status: "queued" }, new ApiError("EXPORT_FAILED", 500)]);
  await act(() => result.current.start());
  await tick(POLL_MS);
  expect(result.current.phase).toBe("idle");
  expect(screen.getByText("Couldn't build your archive. Try again.")).toBeTruthy();
  await tick(5 * POLL_MS);
  expect(api.downloadExport).toHaveBeenCalledTimes(2);
});

test("a failed request goes back to idle", async () => {
  const { api, result } = await setup([READY]);
  (api.requestExport as jest.Mock).mockRejectedValueOnce(new ApiError("SERVER", 500));
  await act(() => result.current.start());
  expect(result.current.phase).toBe("idle");
  expect(api.downloadExport).not.toHaveBeenCalled();
});

test("the export carries on after the screen is gone, and the next screen finds it", async () => {
  const first = await setup([{ status: "queued" }, READY]);
  await act(() => first.result.current.start());
  await first.unmount();
  await tick(POLL_MS);
  expect(first.api.downloadExport).toHaveBeenCalledTimes(2);

  const again = await setup([READY], { client: first.client });
  expect(again.result.current.phase).toBe("ready");
  await act(() => again.result.current.download());
  expect(mockShare).toHaveBeenCalledWith("lately-export-20261010.json", "{}");
  // Coming back doesn't start over.
  expect(again.api.requestExport).not.toHaveBeenCalled();
});

test("a new export never offers the previous file, and starting twice asks once", async () => {
  const { api, result } = await setup([READY]);
  await act(() => result.current.start());
  expect(result.current.phase).toBe("ready");
  (api.downloadExport as jest.Mock).mockResolvedValue({ status: "queued" });
  await act(() => result.current.start());
  expect(result.current.phase).toBe("preparing");
  await act(() => result.current.start());
  expect(api.requestExport).toHaveBeenCalledTimes(2);
  await act(() => result.current.download());
  expect(mockShare).not.toHaveBeenCalled();
});

test("signing out (the cache is cleared) stops a running export", async () => {
  const { api, client, result } = await setup([{ status: "queued" }]);
  await act(() => result.current.start());
  await act(async () => client.clear());
  expect(result.current.phase).toBe("idle");
  await tick(5 * POLL_MS);
  expect(api.downloadExport).toHaveBeenCalledTimes(1);
});
