import { useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useState } from "react";

import { pushedOnStack, type NavLike } from "./pushedOnStack";

/** `pushedOnStack` for the current screen, re-read whenever the screen gains focus. */
export function useIsPushed(): boolean {
  const navigation = useNavigation() as unknown as NavLike;
  const [pushed, setPushed] = useState(() => pushedOnStack(navigation));
  useFocusEffect(
    useCallback(() => {
      setPushed(pushedOnStack(navigation));
    }, [navigation]),
  );
  return pushed;
}
