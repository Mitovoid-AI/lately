import { Image } from "expo-image";
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/** Rounded media frame; the image fades in when it loads. */
export function Thumb({
  uri,
  aspect = 4 / 5,
  radius = 14,
  children,
  style,
  className = "",
}: {
  uri: string | null;
  aspect?: number;
  radius?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  return (
    <View
      className={`w-full overflow-hidden bg-raised ${className}`}
      style={[{ aspectRatio: aspect, borderRadius: radius }, style]}
    >
      {uri ? (
        <Image source={{ uri }} contentFit="cover" transition={300} style={{ width: "100%", height: "100%" }} />
      ) : null}
      {children}
    </View>
  );
}
