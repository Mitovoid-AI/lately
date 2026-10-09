import { Image } from "expo-image";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

/** Images dissolve in over 250 ms once decoded (off the JS thread), so nothing pops. */
export const IMAGE_FADE = { duration: 250, effect: "cross-dissolve", timing: "ease-out" } as const;

/** Rounded media frame; the image fades in when it loads. */
export function Thumb({
  uri,
  aspect = 4 / 5,
  radius = 14,
  children,
  style,
  mediaStyle,
  className = "",
}: {
  uri: string | null;
  aspect?: number;
  radius?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** An animated style for the image layer (parallax). */
  mediaStyle?: ComponentProps<typeof Animated.View>["style"];
  className?: string;
}) {
  return (
    <View
      className={`w-full overflow-hidden bg-raised ${className}`}
      style={[{ aspectRatio: aspect, borderRadius: radius }, style]}
    >
      {uri ? (
        mediaStyle ? (
          <Animated.View style={[StyleSheet.absoluteFill, mediaStyle]}>
            <Image source={{ uri }} contentFit="cover" transition={IMAGE_FADE} style={styles.fill} />
          </Animated.View>
        ) : (
          <Image source={{ uri }} recyclingKey={uri} contentFit="cover" transition={IMAGE_FADE} style={styles.fill} />
        )
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { width: "100%", height: "100%" } });
