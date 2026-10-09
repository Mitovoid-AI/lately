import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DURATION, EASE_OUT } from "../theme/motion";

const ToastContext = createContext<{ show(message: string): void }>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// Rises into place and leaves the way it came, a little quicker than it arrived.
const TOAST_IN = FadeInDown.duration(DURATION.enter).easing(EASE_OUT);
const TOAST_OUT = FadeOutDown.duration(DURATION.exit).easing(EASE_OUT);

/** One message at a time, above the tab bar, gone after 2.5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const show = useCallback((m: string) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, message: m });
    timer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <View className="flex-1">
        {children}
        {toast ? (
          <Animated.View
            key={toast.id}
            entering={TOAST_IN}
            exiting={TOAST_OUT}
            style={{ pointerEvents: "none", position: "absolute", left: 16, right: 16, bottom: insets.bottom + 80, alignItems: "center" }}
          >
            <View accessibilityRole="alert" className="max-w-[420px] rounded-ctl bg-ink px-4 py-3">
              <Text className="text-center font-sans-medium text-meta text-on-accent">{toast.message}</Text>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}
