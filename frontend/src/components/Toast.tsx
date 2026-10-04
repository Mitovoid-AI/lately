import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

const ToastContext = createContext<{ show(message: string): void }>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/** One message at a time, bottom of the screen, gone after 2.5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(m);
    timer.current = setTimeout(() => setMessage(null), 2500);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <View className="flex-1">
        {children}
        {message ? (
          <View pointerEvents="none" className="absolute bottom-24 left-4 right-4 items-center">
            <View accessibilityRole="alert" className="max-w-[420px] rounded-ctl bg-ink px-4 py-3">
              <Text className="text-center font-sans-medium text-meta text-on-accent">{message}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}
