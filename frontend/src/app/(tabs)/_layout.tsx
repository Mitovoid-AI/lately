import { Tabs, useRouter } from "expo-router";

import { TabBar } from "../../components/TabBar";

/** Home, Search, Save, Stacks: the order here is the order of the bar. */
export default function TabsLayout() {
  const router = useRouter();
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
