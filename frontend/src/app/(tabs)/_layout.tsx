import { Tabs, useRouter } from "expo-router";

import { TabBar } from "../../components/TabBar";

export default function TabsLayout() {
  const router = useRouter();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="curated" options={{ title: "Curated" }} />
      <Tabs.Screen name="index" options={{ title: "Library" }} />
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
