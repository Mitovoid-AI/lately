import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DURATION, EASE_OUT } from "../theme/motion";

interface ToastApi {
  /** Shows one message. Problems and long messages stay longer; pass `duration` (ms) to choose. */
  show(message: string, options?: { duration?: number }): void;
  /** A modal (sheet, dialog) calls this while it is open so the toast draws above it, once. */
  claimOverlay(): () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, claimOverlay: () => () => {} });
const ToastStateContext = createContext<{ id: number; message: string } | null>(null);

export function useToast() {
  return useContext(ToastContext);
}

// Rises into place and leaves the way it came, a little quicker than it arrived. With Reduce
// Motion on it only fades: nothing travels.
const TOAST_IN = FadeInDown.duration(DURATION.enter).easing(EASE_OUT);
const TOAST_OUT = FadeOutDown.duration(DURATION.exit).easing(EASE_OUT);
const TOAST_IN_REDUCED = FadeIn.duration(DURATION.exit);
const TOAST_OUT_REDUCED = FadeOut.duration(DURATION.exit);

/**
 * Distance from the bottom edge (plus the inset): above the tab bar (64) and above the offline
 * banner that sits on it (about 48 with two lines), so the two never overlap.
 */
const TOAST_BOTTOM = 112;

/** A plain confirmation is gone in 2.5 s; a problem or a long line gets 4.5 s to be read. */
export const TOAST_MS = 2500;
export const TOAST_LONG_MS = 4500;
const PROBLEM = /n't\b|try again/i;
const LONG_LINE = 36;

export function toastDuration(message: string): number {
  return PROBLEM.test(message) || message.length > LONG_LINE ? TOAST_LONG_MS : TOAST_MS;
}

/**
 * One message at a time, above the tab bar, gone after 2.5 s (4.5 s for a problem). An ink slab
 * with canvas-coloured text (18.6:1 light, 15.9:1 espresso), so it inverts with the theme. It is
 * also spoken: role "alert" is not announced on Android, so `show` announces it itself.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [overlays, setOverlays] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const show = useCallback((m: string, options?: { duration?: number }) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, message: m });
    AccessibilityInfo.announceForAccessibility(m);
    timer.current = setTimeout(() => setToast(null), options?.duration ?? toastDuration(m));
  }, []);
  const claimOverlay = useCallback(() => {
    setOverlays((n) => n + 1);
    return () => setOverlays((n) => Math.max(0, n - 1));
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const value = useMemo(() => ({ show, claimOverlay }), [show, claimOverlay]);

  return (
    <ToastContext.Provider value={value}>
      <ToastStateContext.Provider value={toast}>
        <View className="flex-1">
          {children}
          {/* While a sheet or dialog is open its own layer shows the toast; two would repeat it. */}
          {overlays === 0 ? <ToastBubble placement="bottom" /> : null}
        </View>
      </ToastStateContext.Provider>
    </ToastContext.Provider>
  );
}

/**
 * The toast, drawn inside a modal. A React Native Modal is its own window, above the provider's
 * toast, so a failure while a sheet or dialog is open would otherwise be invisible. It sits at
 * the top: the bottom of a sheet is where its buttons are.
 */
export function ToastLayer() {
  const { claimOverlay } = useToast();
  useEffect(() => claimOverlay(), [claimOverlay]);
  return <ToastBubble placement="top" />;
}

function ToastBubble({ placement }: { placement: "top" | "bottom" }) {
  const toast = useContext(ToastStateContext);
  return toast ? <ToastView toast={toast} placement={placement} /> : null;
}

// Split from ToastBubble so the safe-area hook only runs while a toast is up.
function ToastView({ toast, placement }: { toast: { id: number; message: string }; placement: "top" | "bottom" }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Animated.View
      key={toast.id}
      entering={reduced ? TOAST_IN_REDUCED : TOAST_IN}
      exiting={reduced ? TOAST_OUT_REDUCED : TOAST_OUT}
      style={{
        pointerEvents: "none",
        position: "absolute",
        left: 16,
        right: 16,
        alignItems: "center",
        ...(placement === "top" ? { top: insets.top + 12 } : { bottom: insets.bottom + TOAST_BOTTOM }),
      }}
    >
      <View accessibilityRole="alert" className="max-w-[420px] rounded-ctl bg-ink px-4 py-3">
        <Text className="text-center font-sans-medium text-meta text-canvas">{toast.message}</Text>
      </View>
    </Animated.View>
  );
}
