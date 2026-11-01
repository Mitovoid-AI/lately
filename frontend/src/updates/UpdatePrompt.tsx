import { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue } from "react-native-reanimated";

import { Button } from "../components/Button";
import { usePresence } from "../components/motion/usePresence";
import { useTheme } from "../theme/ThemeProvider";
import { downloadApk, openInstaller } from "./apk";
import { findNewerRelease, updateSource, type ApkRelease } from "./release";

type Step =
  | { kind: "offer" }
  | { kind: "downloading"; fraction: number }
  | { kind: "ready"; fileUri: string }
  | { kind: "failed"; during: "download" | "install"; fileUri?: string };

const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1_000_000));

/**
 * Test APKs only (see updateSource): on launch, asks GitHub for a newer test build and offers
 * it. Update now downloads it with a progress bar, then Install hands the file to Android's
 * installer. Later hides the offer until the next launch. Built like ConfirmDialog: a centered
 * card over a dimmed backdrop, buttons stacked with the main one on top.
 */
export function UpdatePrompt() {
  const [offer, setOffer] = useState<{ release: ApkRelease; installedBuild: number } | null>(null);
  const [step, setStep] = useState<Step>({ kind: "offer" });
  const [dismissed, setDismissed] = useState(false);
  const download = useRef<AbortController | null>(null);

  useEffect(() => {
    const source = updateSource();
    if (!source) return;
    let live = true;
    void findNewerRelease(source.repo, source.installedBuild).then((release) => {
      if (live && release) setOffer({ release, installedBuild: source.installedBuild });
    });
    return () => {
      live = false;
      download.current?.abort();
    };
  }, []);

  const start = async () => {
    if (!offer) return;
    const controller = new AbortController();
    download.current = controller;
    setStep({ kind: "downloading", fraction: 0 });
    try {
      const fileUri = await downloadApk(
        offer.release,
        // A late progress event must not pull a finished or cancelled download back.
        (fraction) => setStep((s) => (s.kind === "downloading" ? { kind: "downloading", fraction } : s)),
        controller.signal,
      );
      setStep({ kind: "ready", fileUri });
    } catch {
      if (!controller.signal.aborted) setStep({ kind: "failed", during: "download" });
    }
  };

  const install = async (fileUri: string) => {
    try {
      await openInstaller(fileUri);
    } catch {
      setStep({ kind: "failed", during: "install", fileUri });
    }
  };

  const cancelDownload = () => {
    download.current?.abort();
    setStep({ kind: "offer" });
  };

  const later = () => {
    download.current?.abort();
    setDismissed(true);
  };

  if (!offer) return null;
  const { release, installedBuild } = offer;
  const busy = step.kind === "downloading";

  let title: string;
  let message: string;
  let actions: { label: string; onPress: () => void; icon?: "cloud-download" }[];
  switch (step.kind) {
    case "offer":
      title = "Update available";
      message = `Test build ${release.build} is out (${mb(release.bytes)} MB). You have build ${installedBuild}.`;
      actions = [{ label: "Update now", onPress: () => void start(), icon: "cloud-download" }];
      break;
    case "downloading":
      title = `Downloading build ${release.build}`;
      message = `${mb(release.bytes * step.fraction)} of ${mb(release.bytes)} MB · ${Math.round(step.fraction * 100)}%`;
      actions = [];
      break;
    case "ready": {
      const { fileUri } = step;
      title = "Ready to install";
      message =
        "Android asks you to confirm the update. The first time, it also asks you to allow installs from Lately: turn that on, then go back.";
      actions = [{ label: "Install", onPress: () => void install(fileUri) }];
      break;
    }
    case "failed": {
      const { fileUri } = step;
      title = step.during === "download" ? "The download didn't finish" : "Couldn't open the installer";
      message =
        step.during === "download"
          ? "Check your connection and try again."
          : `Try again, or install build ${release.build} from the Lately website.`;
      actions = [{ label: "Try again", onPress: () => void (fileUri ? install(fileUri) : start()) }];
      break;
    }
  }

  return (
    <UpdateDialog
      visible={!dismissed}
      title={title}
      message={message}
      fraction={step.kind === "downloading" ? step.fraction : null}
      actions={actions}
      secondary={busy ? { label: "Cancel", onPress: cancelDownload } : { label: "Later", onPress: later }}
    />
  );
}

function UpdateDialog({
  visible,
  title,
  message,
  fraction,
  actions,
  secondary,
}: {
  visible: boolean;
  title: string;
  message: string;
  /** Download progress from 0 to 1, or null when nothing is downloading. */
  fraction: number | null;
  actions: { label: string; onPress: () => void; icon?: "cloud-download" }[];
  secondary: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const mounted = usePresence(visible, progress, { enter: 240, exit: 160 });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: reduced ? 1 : 0.96 + 0.04 * progress.get() }],
  }));
  if (!visible && !mounted) return null;
  const percent = fraction === null ? 0 : Math.round(fraction * 100);

  return (
    // Back does what the lower button says: Later, or Cancel while downloading.
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={secondary.onPress}>
      <View className="flex-1 items-center justify-center px-6">
        {/* No tap-outside dismiss: an update offer shouldn't vanish on a stray tap. */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }, backdropStyle]} />
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <View className="w-full rounded-2xl border border-hairline bg-card p-6">
            <Text accessibilityRole="header" className="font-display text-display-sm text-ink">
              {title}
            </Text>
            {fraction !== null ? (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Download progress"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                className="mt-4 h-2 w-full overflow-hidden rounded-full bg-raised"
              >
                <View className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
              </View>
            ) : null}
            <Text className={`${fraction !== null ? "mt-3" : "mt-2"} font-sans text-body text-ink-2`}>{message}</Text>
            <View className="mt-6 gap-2">
              {actions.map((a) => (
                <Button key={a.label} title={a.label} icon={a.icon} onPress={a.onPress} />
              ))}
              <Button title={secondary.label} variant="secondary" onPress={secondary.onPress} />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: "100%", maxWidth: 340 },
});
