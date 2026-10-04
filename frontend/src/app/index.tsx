// Temporary signed-in landing page; the tab layout replaces it in the next task.
import { Text, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";

export default function Index() {
  const { user, signOut } = useAuth();
  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <Text className="font-display text-display-lg text-ink">Hi, {user?.name}</Text>
      <Text onPress={signOut} className="mt-4 font-sans-semibold text-body text-accent">
        Log out
      </Text>
    </View>
  );
}
