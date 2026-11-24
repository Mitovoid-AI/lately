// Settings' "Check for updates" runs the launch check again and, when a newer test build is out,
// reopens UpdatePrompt's dialog through this tiny event channel (even after "Later").
import { checkForUpdate, updateSource, type ApkRelease } from "./release";

export type UpdateOffer = { release: ApkRelease; installedBuild: number };

const listeners = new Set<(offer: UpdateOffer) => void>();

/** UpdatePrompt listens here; returns the unsubscribe. */
export function onUpdateOffer(listener: (offer: UpdateOffer) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showUpdateOffer(offer: UpdateOffer): void {
  for (const l of listeners) l(offer);
}

/**
 * Checks GitHub now. "offered": a newer build is out and the update dialog is open; "current":
 * nothing newer (or a build that doesn't update itself); "failed": no answer.
 */
export async function checkForUpdatesNow(): Promise<"offered" | "current" | "failed"> {
  const source = updateSource();
  if (!source) return "current";
  const check = await checkForUpdate(source.repo, source.installedBuild);
  if (check.status !== "newer") return check.status;
  showUpdateOffer({ release: check.release, installedBuild: source.installedBuild });
  return "offered";
}
