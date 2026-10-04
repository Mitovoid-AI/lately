import AsyncStorage from "@react-native-async-storage/async-storage";

/** The slice of AsyncStorage the app uses; tests pass an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const deviceStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

export async function readJson<T>(store: KeyValueStore, key: string, fallback: T): Promise<T> {
  try {
    const raw = await store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  try {
    await store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing); the app still works without it.
  }
}
