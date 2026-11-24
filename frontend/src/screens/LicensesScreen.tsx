import { Linking, Text, View } from "react-native";

import { Icon } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { SubScreen } from "../components/settings/SubScreen";
import { useToast } from "../components/Toast";
import { FONTS, OFL_TEXT, PACKAGES, type PackageLicense } from "../legal/licenses";
import { useTheme } from "../theme/ThemeProvider";

function PackageRow({ p, divider }: { p: PackageLicense; divider: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const body = (
    <>
      <View className="flex-1">
        <Text className="font-sans-medium text-body text-ink">{`${p.name} ${p.version}`}</Text>
        <Text className="font-sans text-meta text-ink-2">{p.license}</Text>
      </View>
      {p.url ? <Icon name="open-in-new" size={18} color={colors.ink2} /> : null}
    </>
  );
  return (
    <View className={divider ? "border-t border-hairline" : ""}>
      {p.url ? (
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel={`${p.name} ${p.version}, ${p.license}`}
          onPress={() => void Linking.openURL(p.url!).catch(() => toast.show("Couldn't open the page. Try again."))}
          scaleTo={1}
          highlightColor={colors.raised}
          className="min-h-12 flex-row items-center px-4 py-3"
        >
          {body}
        </PressableScale>
      ) : (
        <View className="min-h-12 flex-row items-center px-4 py-3">{body}</View>
      )}
    </View>
  );
}

/** Account > Legal > Open-source licenses: the fonts and libraries Lately ships, from scripts/build-licenses.js. */
export function LicensesScreen() {
  return (
    <SubScreen title="Open-source licenses">
      <Text accessibilityRole="header" className="font-display text-display-lg text-ink">
        Open-source licenses
      </Text>
      <Text className="mt-2 font-sans text-body text-ink-2">
        Lately is built with these open-source fonts and libraries. Thank you to the people who make them.
      </Text>

      <Text accessibilityRole="header" className="mt-8 font-display text-display-sm text-ink">
        Fonts
      </Text>
      <View className="mt-3 rounded-2xl border border-hairline bg-card">
        {FONTS.map((f, i) => (
          <View key={f.family} className={`px-4 py-3 ${i > 0 ? "border-t border-hairline" : ""}`}>
            <Text className="font-sans-medium text-body text-ink">{f.family}</Text>
            <Text className="font-sans text-meta text-ink-2">{f.copyright}</Text>
            <Text className="font-sans text-meta text-ink-2">{f.license}</Text>
          </View>
        ))}
      </View>

      <Text accessibilityRole="header" className="mt-8 font-display text-display-sm text-ink">
        Libraries
      </Text>
      <View className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-card">
        {PACKAGES.map((p, i) => (
          <PackageRow key={p.name} p={p} divider={i > 0} />
        ))}
      </View>

      <Text accessibilityRole="header" className="mt-8 font-display text-display-sm text-ink">
        SIL Open Font License 1.1
      </Text>
      <Text selectable className="mt-3 font-sans text-meta text-ink-2">
        {OFL_TEXT}
      </Text>
    </SubScreen>
  );
}
