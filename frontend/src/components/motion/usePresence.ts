import { useEffect, useState } from "react";
import { withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { DURATION, EASE_OUT, EASE_SHEET } from "../../theme/motion";

/**
 * Keeps an overlay mounted long enough to animate out. `progress` runs 0 → 1 when `visible`
 * turns on and 1 → 0 when it turns off; the overlay unmounts once the exit lands.
 * Reopening mid-exit simply reverses it.
 */
export function usePresence(
  visible: boolean,
  progress: SharedValue<number>,
  { enter = DURATION.sheet, exit = DURATION.exit }: { enter?: number; exit?: number } = {},
): boolean {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      progress.set(withTiming(1, { duration: enter, easing: EASE_SHEET }));
      return;
    }
    progress.set(
      withTiming(0, { duration: exit, easing: EASE_OUT }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [visible, progress, enter, exit]);

  return mounted;
}
