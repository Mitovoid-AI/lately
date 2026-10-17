import { Text, View } from "react-native";

import { useTheme } from "../theme/ThemeProvider";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Reveal } from "./motion/Reveal";

/** A load that failed: what didn't load, why it might have, and a retry. */
export function ErrorState({
  title,
  body = "Check your connection and try again.",
  icon = "cloud-off",
  onRetry,
  retrying,
}: {
  title: string;
  body?: string;
  icon?: IconName;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Reveal>
      <View className="items-center px-6 pt-16">
        <Icon name={icon} size={40} color={colors.ink3} />
        <Text className="mt-4 text-center font-display text-display-md text-ink">{title}</Text>
        <Text className="mt-2 text-center font-sans text-body text-ink-2">{body}</Text>
        {onRetry ? (
          <Button title="Try again" variant="secondary" onPress={onRetry} loading={retrying} className="mt-6 w-full max-w-[320px]" />
        ) : null}
      </View>
    </Reveal>
  );
}
