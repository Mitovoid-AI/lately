import { Text, View } from "react-native";

import { Button } from "../Button";
import { ExamplePair } from "../ExamplePair";
import { Reveal } from "../motion/Reveal";
import { openInstagram } from "./openInstagram";

/**
 * Home with nothing saved yet: say what Lately does, show it once, then point at the one move
 * that starts it. No numbered steps, no tour.
 */
export function FirstRun({ onPaste, onOpenInstagram = () => void openInstagram() }: { onPaste: () => void; onOpenInstagram?: () => void }) {
  return (
    <View className="w-full max-w-[420px] self-center px-4 pt-6">
      <Reveal index={0}>
        <Text className="font-display-heavy text-display-lg text-ink">Every reel you save, findable in one search.</Text>
      </Reveal>
      <Reveal index={1} style={{ marginTop: 24 }}>
        <ExamplePair />
      </Reveal>
      <Reveal index={2} style={{ marginTop: 28 }}>
        {/* Android's flow: Instagram's own Share sheet, then its "Share to…" row opens the system sheet that lists Lately. */}
        <Text className="font-sans-medium text-body text-ink">In Instagram, tap Share, then Share to…, then Lately.</Text>
      </Reveal>
      <Reveal index={3} style={{ marginTop: 16, gap: 12 }}>
        <Button title="Open Instagram" icon="open-in-new" onPress={onOpenInstagram} />
        <Button title="Paste a link instead" variant="secondary" icon="link" onPress={onPaste} />
      </Reveal>
    </View>
  );
}
