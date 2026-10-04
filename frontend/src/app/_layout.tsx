import "../../global.css";

import { Inter_400Regular, Inter_400Regular_Italic, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Lora_400Regular } from "@expo-google-fonts/lora";
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from "@expo-google-fonts/newsreader";
import { useFonts } from "expo-font";
import { Slot } from "expo-router";

export default function RootLayout() {
  const [loaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Lora_400Regular,
  });
  if (!loaded) return null;
  return <Slot />;
}
