import { act, renderHook, waitFor } from "@testing-library/react-native";
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

async function setup(downloads: (ExportDownload | Error)[], o: { pollMs?: number; giveUpMs?: number } = {}) {
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ApiProvider api={api}>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
  const hook = await renderHook(() => useExport({ pollMs: o.pollMs ?? 5, giveUpMs: o.giveUpMs ?? 2000 }), { wrapper });
  return { api, ...hook };
}

beforeEach(() => jest.clearAllMocks());

test("requests an export, polls while it is queued, then is ready", async () => {
  const { api, result } = await setup([{ status: "queued" }, { status: "queued" }, READY]);
  expect(result.current.phase).toBe("idle");
  await act(() => result.current.start());
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(api.requestExport).toHaveBeenCalledTimes(1);
  expect(api.downloadExport).toHaveBeenCalledTimes(3);
});

test("a screen reader is told when the archive is ready", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  const { result } = await setup([{ status: "queued" }, READY]);
  await act(() => result.current.start());
  expect(announce).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith("Your archive is ready");
  announce.mockRestore();
});

test("download writes the file and opens the share sheet", async () => {
  const { result } = await setup([READY]);
  await act(() => result.current.start());
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await act(() => result.current.download());
  expect(mockShare).toHaveBeenCalledWith("lately-export-20261010.json", "{}");
  expect(result.current.phase).toBe("ready");
});

test("gives up after the time limit and goes back to idle", async () => {
  const { result } = await setup([{ status: "queued" }], { pollMs: 5, giveUpMs: 30 });
  await act(() => result.current.start());
  expect(result.current.phase).toBe("preparing");
  await waitFor(() => expect(result.current.phase).toBe("idle"));
});

test("a network blip while polling keeps polling", async () => {
  const { result } = await setup([new ApiError("NETWORK", 0), READY]);
  await act(() => result.current.start());
  await waitFor(() => expect(result.current.phase).toBe("ready"));
});

test("a failed request goes back to idle", async () => {
  const { api, result } = await setup([READY]);
  (api.requestExport as jest.Mock).mockRejectedValueOnce(new ApiError("SERVER", 500));
  await act(() => result.current.start());
  expect(result.current.phase).toBe("idle");
  expect(api.downloadExport).not.toHaveBeenCalled();
});
