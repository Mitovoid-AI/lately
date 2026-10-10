import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, type ExportDownload } from "../api/contract";
import { useApi } from "../api/index";
import { useToast } from "../components/Toast";
import { shareExportFile } from "../lib/exportFile";
import { haptic } from "../lib/haptics";

export type ExportPhase = "idle" | "preparing" | "ready" | "sharing";

type ReadyExport = Extract<ExportDownload, { status: "ready" }>;

/**
 * The account archive, delivered in the app: ask the server to build it, poll until the JSON
 * file is ready (giving up after a few minutes), then hand it to the system share sheet.
 * `start` resolves once the export is requested; polling carries on in the background.
 */
export function useExport({ pollMs = 3000, giveUpMs = 3 * 60_000 }: { pollMs?: number; giveUpMs?: number } = {}) {
  const api = useApi();
  const toast = useToast();
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const file = useRef<ReadyExport | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);

  // The wait between polls; unmounting ends it at once so no timer outlives the screen.
  const wake = useRef<{ timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>(null);
  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        wake.current = { timer: setTimeout(resolve, ms), resolve };
      }),
    [],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (wake.current) {
        clearTimeout(wake.current.timer);
        wake.current.resolve();
      }
    };
  }, []);

  const finish = useCallback(
    (next: ExportPhase, message?: string) => {
      busy.current = false;
      if (!alive.current) return;
      setPhase(next);
      if (message) toast.show(message);
    },
    [toast],
  );

  const poll = useCallback(async () => {
    const until = Date.now() + giveUpMs;
    while (alive.current) {
      try {
        const out = await api.downloadExport();
        if (out.status === "ready") {
          file.current = out;
          haptic.success();
          finish("ready");
          return;
        }
      } catch (e) {
        // A dropped connection is worth waiting out; anything else won't fix itself.
        if (!(e instanceof ApiError && e.code === "NETWORK")) {
          finish("idle", "Couldn't prepare your archive. Try again.");
          return;
        }
      }
      if (Date.now() >= until) break;
      await sleep(pollMs);
    }
    finish("idle", "Your archive is taking longer than usual. Try again in a few minutes.");
  }, [api, finish, sleep, pollMs, giveUpMs]);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("preparing");
    try {
      await api.requestExport();
    } catch {
      haptic.error();
      finish("idle", "Couldn't start the export. Try again.");
      return;
    }
    void poll();
  }, [api, finish, poll]);

  const download = useCallback(async () => {
    const ready = file.current;
    if (!ready || busy.current) return;
    busy.current = true;
    setPhase("sharing");
    try {
      await shareExportFile(ready.filename, ready.json);
      finish("ready");
    } catch {
      finish("ready", "Couldn't open the share sheet. Try again.");
    }
  }, [finish]);

  return { phase, start, download };
}
