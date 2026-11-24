import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { SubScreen } from "../components/settings/SubScreen";
import { useInstagramLink } from "../components/settings/useInstagramLink";
import { useTheme } from "../theme/ThemeProvider";

function Way({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View className="mt-4 flex-row rounded-2xl border border-hairline bg-card p-4">
      <View className="h-11 w-11 items-center justify-center rounded-xl bg-raised">
        <Icon name={icon} size={20} color={colors.ink2} />
      </View>
      <View className="ml-3 flex-1">
        <Text accessibilityRole="header" className="font-sans-semibold text-body text-ink">
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

/**
 * Account > Help > How to save from Instagram: the steps Home shows only before the first save,
 * kept here for good. The Instagram message way is listed only while that connection is offered.
 */
export function HelpScreen() {
  const router = useRouter();
  const link = useInstagramLink().data;
  const dm = link?.enabled && link.handle ? link : null;

  return (
    <SubScreen title="Help">
      <Text accessibilityRole="header" className="font-display text-display-lg text-ink">
        How to save from Instagram
      </Text>
      <Text className="mt-2 font-sans text-body text-ink-2">
        Lately saves the reel and makes a card from it, so you can find it later by what you remember.
      </Text>

      <Way icon="ios-share" title="Share it to Lately">
        {/* Android's flow, as Home's first-run screen says it: the "Share to…" row opens the system sheet that lists Lately. */}
        <Text className="mt-1 font-sans text-body text-ink-2">
          In Instagram, tap Share, then Share to… (on some phones, More), then Lately.
        </Text>
      </Way>

      <Way icon="link" title="Paste a link">
        <Text className="mt-1 font-sans text-body text-ink-2">
          In Instagram, tap Share, then Copy link. In Lately, tap Save (the + at the bottom) and paste it.
        </Text>
      </Way>

      {dm ? (
        <Way icon="instagram" title="Send it in a message">
          <Text className="mt-1 font-sans text-body text-ink-2">
            {dm.linked
              ? `In Instagram, send the reel to @${dm.handle}. It's saved to your library.`
              : `In Instagram, send the reel to @${dm.handle} and it's saved to your library. Connect your account once first.`}
          </Text>
          {dm.linked ? null : (
            <Button title="Connect Instagram" variant="secondary" onPress={() => router.push("/instagram")} className="mt-3" />
          )}
        </Way>
      ) : null}
    </SubScreen>
  );
}
