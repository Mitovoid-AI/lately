import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { useApi } from "../api/index";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { refreshSaveViews } from "../lib/queryClient";
import { dequeueSave, enqueueSave, flushQueue, queueKey, readQueue, type QueuedSave } from "../lib/saveQueue";
import { deviceStore, type KeyValueStore } from "../lib/storage";

/** How often a non-empty queue is retried while the app is open (catches reconnects). */
export const QUEUE_RETRY_MS = 30_000;

interface SaveQueueValue {
  queued: QueuedSave[];
  /** Keep a save for later (createSave failed with NETWORK). */
  enqueue(text: string): Promise<void>;
  /** Take a text off the queue (it was saved another way). */
  dequeue(text: string): Promise<void>;
  /** Try sending everything queued now. */
  flush(): Promise<void>;
  flushing: boolean;
}

const SaveQueueContext = createContext<SaveQueueValue>({
  queued: [],
  enqueue: async () => {},
  dequeue: async () => {},
  flush: async () => {},
  flushing: false,
});

export function useSaveQueue() {
  return useContext(SaveQueueContext);
}

const reels = (n: number) => (n === 1 ? "1 reel" : `${n} reels`);

/**
 * The offline save queue for the signed-in account: retried when the app comes to the
 * foreground, on sign-in, and every 30 s while anything is waiting.
 */
export function SaveQueueProvider({
  children,
  store = deviceStore,
  retryMs = QUEUE_RETRY_MS,
}: {
  children: ReactNode;
  store?: KeyValueStore;
  retryMs?: number;
}) {
  const api = useApi();
  const { status, user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = status === "signed-in" && user ? queueKey(user.id) : null;
  const [queued, setQueued] = useState<QueuedSave[]>([]);
  const [flushing, setFlushing] = useState(false);
  const running = useRef(false);

  const flush = useCallback(async () => {
    if (!key || running.current) return;
    running.current = true;
    setFlushing(true);
    try {
      const pending = await readQueue(store, key);
      if (pending.length === 0) {
        setQueued([]);
        return;
      }
      const r = await flushQueue(store, key, api);
      setQueued(r.remaining);
      if (r.saved.length) {
        refreshSaveViews(queryClient);
        toast.show(`Saved ${reels(r.saved.length)} you shared offline`);
      }
      if (r.dropped.length) toast.show(`Couldn't save ${reels(r.dropped.length)} you shared offline`);
    } finally {
      running.current = false;
      setFlushing(false);
    }
  }, [key, store, api, queryClient, toast]);

  const enqueue = useCallback(
    async (text: string) => {
      if (!key) return;
      setQueued(await enqueueSave(store, key, text));
    },
    [key, store],
  );

  const dequeue = useCallback(
    async (text: string) => {
      if (!key) return;
      setQueued(await dequeueSave(store, key, text));
    },
    [key, store],
  );

  // On sign-in (or a new account): load and try the queue.
  useEffect(() => {
    if (!key) return;
    let active = true;
    readQueue(store, key).then((items) => {
      if (!active) return;
      setQueued(items);
      if (items.length) flush();
    });
    return () => {
      active = false;
    };
  }, [key, store, flush]);

  // Back in the foreground: the connection may be back.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });
    return () => sub?.remove();
  }, [flush]);

  // While something waits, keep trying.
  const waiting = queued.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => flush(), retryMs);
    return () => clearInterval(id);
  }, [waiting, retryMs, flush]);

  const value = useMemo(
    () => ({ queued: key ? queued : [], enqueue, dequeue, flush, flushing }),
    [key, queued, enqueue, dequeue, flush, flushing],
  );
  return <SaveQueueContext.Provider value={value}>{children}</SaveQueueContext.Provider>;
}
