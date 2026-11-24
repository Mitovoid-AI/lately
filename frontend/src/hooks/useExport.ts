import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { ApiError, type ExportDownload, type LatelyApi } from "../api/contract";
import { useApi } from "../api/index";
import { useToast } from "../components/Toast";
import { shareExportFile } from "../lib/exportFile";
import { haptic } from "../lib/haptics";

export type ExportPhase = "idle" | "preparing" | "ready" | "sharing";

/** Said once the file is built, as a toast (which is also spoken): the person may be on another screen by then. */
const READY_TEXT = "Your archive is ready";

type ReadyExport = Extract<ExportDownload, { status: "ready" }>;

/**
 * Where the export stands. It lives in the query cache, not in the screen: leaving Account and
 * coming back finds it still preparing (or ready), and sign-out, which clears the cache, forgets
 * it. `run` tells one export from the next, so a poll that outlived a sign-out stops.
 */
interface ExportState {
  phase: ExportPhase;
  file: ReadyExport | null;
  run: number;
}

const KEY = ["export"];
const IDLE: ExportState = { phase: "idle", file: null, run: 0 };

const read = (client: QueryClient) => client.getQueryData<ExportState>(KEY) ?? IDLE;

function write(client: QueryClient, next: ExportState) {
  // Never garbage-collected: nothing on screen may be watching while it is prepared.
  client.setQueryDefaults(KEY, { gcTime: Infinity });
  client.setQueryData(KEY, next);
}

/**
 * Polls until the JSON file is ready (giving up after a few minutes). Every step first checks
 * that this export is still the current one.
 */
async function poll(
  client: QueryClient,
  api: LatelyApi,
  notify: (message: string) => void,
  run: number,
  { pollMs, giveUpMs }: { pollMs: number; giveUpMs: number },
) {
  const current = () => read(client).run === run;
  const fail = (message: string) => {
    if (!current()) return;
    write(client, { phase: "idle", file: null, run });
    notify(message);
  };
  const until = Date.now() + giveUpMs;
  while (current()) {
    try {
      const out = await api.downloadExport();
      if (out.status === "ready") {
        if (!current()) return;
        write(client, { phase: "ready", file: out, run });
        haptic.success();
        notify(READY_TEXT);
        return;
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "EXPORT_FAILED") return fail("Couldn't build your archive. Try again.");
      // A dropped connection is worth waiting out; anything else won't fix itself.
      if (!(e instanceof ApiError && e.code === "NETWORK")) return fail("Couldn't prepare your archive. Try again.");
    }
    if (Date.now() >= until) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  fail("Your archive is taking a while. Try again in a few minutes.");
}

/**
 * The account archive, delivered in the app: ask the server to build it, poll until the JSON
 * file is ready, then hand it to the system share sheet. `start` resolves once the export is
 * requested; polling carries on in the background, also after the screen is gone.
 */
export function useExport({ pollMs = 3000, giveUpMs = 3 * 60_000 }: { pollMs?: number; giveUpMs?: number } = {}) {
  const api = useApi();
  const toast = useToast();
  const client = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => client.getQueryCache().subscribe(onChange), [client]);
  const { phase } = useSyncExternalStore(subscribe, () => read(client), () => read(client));

  const start = useCallback(async () => {
    const before = read(client);
    if (before.phase === "preparing" || before.phase === "sharing") return;
    // A new export never offers the previous file as its own.
    const run = before.run + 1;
    write(client, { phase: "preparing", file: null, run });
    try {
      await api.requestExport();
    } catch {
      if (read(client).run !== run) return;
      haptic.error();
      write(client, { phase: "idle", file: null, run });
      toast.show("Couldn't start the export. Try again.");
      return;
    }
    void poll(client, api, toast.show, run, { pollMs, giveUpMs });
  }, [api, client, toast, pollMs, giveUpMs]);

  const download = useCallback(async () => {
    const ready = read(client);
    if (ready.phase !== "ready" || !ready.file) return;
    write(client, { ...ready, phase: "sharing" });
    try {
      await shareExportFile(ready.file.filename, ready.file.json);
    } catch {
      toast.show("Couldn't open the share sheet. Try again.");
    }
    if (read(client).run === ready.run) write(client, ready);
  }, [client, toast]);

  return { phase, start, download };
}
