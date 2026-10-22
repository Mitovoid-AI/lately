import { readJson, writeJson, type KeyValueStore } from "../../lib/storage";

/** Where "this person has had their first card" is remembered; wiped with the rest of the device data. */
export const firstCardKey = (userId: string) => `lately.firstCard.${userId}`;
const key = firstCardKey;

/**
 * Is the card just saved the first this person has ever saved? Asked once per person on this
 * phone: the answer is remembered, so it is "yes" at most once, even if they delete everything
 * and start again. `totalSaves` is how many saves the account holds now (this one included): more
 * than one means they were saving long before (an existing user opening a new version, or a new
 * phone), and then there is nothing to celebrate. If that count cannot be read, it is "no" and
 * nothing is remembered, so the next save asks again.
 */
export async function isFirstCard(store: KeyValueStore, userId: string, totalSaves: () => Promise<number>): Promise<boolean> {
  if (await readJson<boolean>(store, key(userId), false)) return false;
  let total: number;
  try {
    total = await totalSaves();
  } catch {
    return false;
  }
  await writeJson(store, key(userId), true);
  return total <= 1;
}
