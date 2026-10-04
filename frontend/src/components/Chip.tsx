import { Pressable, Text, View } from "react-native";

/** Pill chip: 32 high, raised fill; active = marigold with white text. */
export function Chip({
  label,
  active = false,
  dotColor,
  onPress,
  className = "",
}: {
  label: string;
  active?: boolean;
  dotColor?: string;
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ selected: active }}
      disabled={!onPress}
      onPress={onPress}
      className={`h-8 flex-row items-center rounded-full px-3 ${
        active ? "bg-accent" : "bg-raised border border-hairline"
      } ${className}`}
    >
      {dotColor && !active ? (
        <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
      ) : null}
      <Text className={`text-meta ${active ? "font-sans-semibold text-on-accent" : "font-sans-medium text-ink"}`}>
        {label}
      </Text>
    </Pressable>
  );
}
