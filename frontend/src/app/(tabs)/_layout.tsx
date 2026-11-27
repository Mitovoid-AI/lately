import { Redirect, Tabs, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useInstagramGate } from "../../components/settings/useInstagramGate";
import { TabBar } from "../../components/TabBar";
import { useTheme } from "../../theme/ThemeProvider";

/** Home, Search, Save, Stacks: the order here is the order of the bar. */
export default function TabsLayout() {
  const router = useRouter();
  const { colors } = useTheme();
  // An account that hasn't connected Instagram yet does that first (no skip).
  const gate = useInstagramGate();
  if (gate === "connect") return <Redirect href="/connect-instagram" />;
  if (gate === "checking") {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.ink2} accessibilityLabel="Loading Lately" />
      </View>
    );
  }
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
      <Tabs.Screen
        name="save"
        options={{ title: "Save" }}
        listeners={{
          tabPress: (e) => {
            // Save is an action, not a page: it opens the save sheet over the current tab.
            e.preventDefault();
            router.push("/save-sheet");
          },
        }}
      />
      <Tabs.Screen name="stacks" options={{ title: "Stacks" }} />
    </Tabs>
  );
}
