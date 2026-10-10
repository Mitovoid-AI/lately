import { PENDING_SHARE_KEY } from "../share/ShareRouter";
import { RECENT_KEY } from "./recent";
import { queueKey } from "./saveQueue";
import { deviceStore, writeJson, type KeyValueStore } from "./storage";

/**
 * What Lately keeps on the phone for a signed-in person, wiped when they log out or delete
 * their account: recent searches, links waiting in the offline queue, a share waiting for
 * sign-in. (The Supabase session itself is removed by sign-out.)
 */
export async function forgetDeviceData(userId: string | null | undefined, store: KeyValueStore = deviceStore): Promise<void> {
  await Promise.all([
    writeJson(store, RECENT_KEY, []),
    userId ? writeJson(store, queueKey(userId), []) : Promise.resolve(),
    store.setItem(PENDING_SHARE_KEY, "").catch(() => {}),
  ]);
}
