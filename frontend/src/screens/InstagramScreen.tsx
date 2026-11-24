import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Linking, Text, View } from "react-native";

import type { InstagramLink } from "../api/contract";
import { useApi } from "../api/index";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { Icon } from "../components/Icon";
import { longDate } from "../components/settings/longDate";
import { SubScreen } from "../components/settings/SubScreen";
import { codeIsLive, INSTAGRAM_KEY, useInstagramLink } from "../components/settings/useInstagramLink";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useNow } from "../hooks/useNow";
import { haptic } from "../lib/haptics";
import { useTheme } from "../theme/ThemeProvider";

/** How often the screen asks whether the code has arrived, while it is shown. */
export const LINK_POLL_MS = 3000;

const LINKED_TEXT = "Instagram connected";

/**
 * "Expires in 15 minutes" / "Expires in 1 minute", to the nearest minute (the clock it is read
 * against ticks every 10 s, so a fresh code never reads 16) and never 0.
 */
function expiresIn(expiresAt: number, now: number): string {
  const minutes = Math.max(1, Math.round((expiresAt - now) / 60_000));
  return `Expires in ${minutes === 1 ? "1 minute" : `${minutes} minutes`}`;
}

/**
 * Account > Connected accounts > Save from Instagram DMs. Linking: Lately shows a one-time code,
 * the person sends it to Lately's Instagram account, and this screen asks every 3 s (while the
 * code is shown and the screen is in front) until the server has seen it. Once linked, any reel
 * they send there is saved to their library.
 */
export function InstagramScreen() {
  const { colors } = useTheme();
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const now = useNow(10_000);
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Asks again only while a live code is on screen: not once linked, expired, or behind another screen.
  const query = useInstagramLink({ everyMs: LINK_POLL_MS, while: (l) => focused && codeIsLive(l, Date.now()) });
  const link = query.data;
  const codeLive = codeIsLive(link, now);
  const expired = !!link && !link.linked && !!link.code && !codeLive;

  // The code arrived while it was on screen: say so, with the success haptic.
  const sawCode = useRef(false);
  useEffect(() => {
    if (link?.linked && sawCode.current) {
      haptic.success();
      AccessibilityInfo.announceForAccessibility(LINKED_TEXT);
    }
    sawCode.current = codeLive;
  }, [link?.linked, codeLive]);

  const connect = useMutation({
    mutationFn: () => api.createInstagramCode(),
    onSuccess: (fresh) => client.setQueryData(INSTAGRAM_KEY, fresh),
    onError: () => {
      haptic.error();
      toast.show("Couldn't get a code. Try again.");
    },
  });

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => api.unlinkInstagram(),
    onSuccess: () => {
      client.setQueryData<InstagramLink>(INSTAGRAM_KEY, (old) =>
        old ? { ...old, linked: false, linked_at: null, code: null, code_expires_at: null } : old,
      );
      setConfirmDisconnect(false);
      haptic.medium();
      toast.show("Instagram disconnected");
    },
    onError: () => {
      setConfirmDisconnect(false);
      haptic.error();
      toast.show("Couldn't disconnect. Try again.");
    },
  });

  async function copy(code: string) {
    try {
      await Clipboard.setStringAsync(code);
      toast.show("Code copied");
    } catch {
      toast.show("Couldn't copy the code. Select it and copy it instead.");
    }
  }

  async function openChat(handle: string) {
    try {
      await Linking.openURL(`https://ig.me/m/${handle}`);
    } catch {
      toast.show("Couldn't open Instagram. Try again.");
    }
  }

  let content;
  if (query.isPending) {
    content = (
      <SkeletonGroup style={{ gap: 12 }}>
        <Skeleton style={{ height: 32, width: "70%", borderRadius: 10 }} />
        <Skeleton style={{ height: 48, borderRadius: 10 }} />
        <Skeleton style={{ height: 48, borderRadius: 12 }} />
      </SkeletonGroup>
    );
  } else if (query.isError || !link) {
    content = (
      <ErrorState
        title="Couldn't load your Instagram connection"
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  } else if (!link.enabled || !link.handle) {
    content = (
      <ErrorState icon="info-outline" title="Not available yet" body="Saving reels from Instagram messages isn't available right now." />
    );
  } else if (link.linked) {
    const since = link.linked_at ? longDate(link.linked_at) : null;
    content = (
      <>
        <View className="flex-row items-center">
          {/* The check and the word together: the state never rests on colour alone. */}
          <View className="h-11 w-11 items-center justify-center rounded-xl bg-raised">
            <Icon name="check-circle" size={22} color={colors.success} />
          </View>
          <View className="ml-3 flex-1">
            <Text accessibilityRole="header" className="font-display text-display-sm text-ink">
              Connected
            </Text>
            {since ? <Text className="font-sans text-meta text-ink-2">{`Since ${since}`}</Text> : null}
          </View>
        </View>
        <Text className="mt-6 font-sans-semibold text-body text-ink">To save a reel</Text>
        <Text className="mt-1 font-sans text-body text-ink-2">{`In Instagram, tap Share on a reel, then send it to @${link.handle}.`}</Text>
        <Button title="Disconnect" variant="secondary" icon="link-off" onPress={() => setConfirmDisconnect(true)} className="mt-8" />
      </>
    );
  } else if (link.code && codeLive) {
    const { code, handle } = link;
    const expiresAt = Date.parse(link.code_expires_at!);
    content = (
      <>
        <Text className="font-sans text-body text-ink-2">{`Send this code to @${handle} as a message.`}</Text>
        <View className="mt-4 flex-row items-center rounded-2xl border border-hairline bg-card p-4">
          <View className="flex-1">
            <Text selectable accessibilityLabel={`Your code: ${code.split("").join(" ")}`} className="font-display text-display-md text-ink">
              {code}
            </Text>
            <Text className="mt-1 font-sans text-meta text-ink-2">{expiresIn(expiresAt, now)}</Text>
          </View>
          <Button title="Copy" variant="secondary" onPress={() => void copy(code)} className="ml-3" />
        </View>
        <Button title="Open Instagram" icon="open-in-new" onPress={() => void openChat(handle)} className="mt-4" />
        <View className="mt-6 flex-row items-center justify-center" accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.ink2} />
          <Text className="ml-2 font-sans text-meta text-ink-2">Waiting for your message…</Text>
        </View>
      </>
    );
  } else {
    content = (
      <>
        {expired ? (
          <>
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="font-display text-display-sm text-ink">
              That code expired
            </Text>
            <Text className="mt-1 font-sans text-body text-ink-2">Codes last 15 minutes. Get a new one and send that instead.</Text>
          </>
        ) : (
          <Text className="font-sans text-body text-ink-2">
            {`Send any reel to @${link.handle} on Instagram and it's saved to your Lately library. First, connect your account once.`}
          </Text>
        )}
        <Button
          title={expired ? "Get a new code" : "Connect Instagram"}
          icon={expired ? "refresh" : "instagram"}
          loading={connect.isPending}
          onPress={() => connect.mutate()}
          className="mt-6"
        />
      </>
    );
  }

  return (
    <SubScreen title="Instagram">
      <Text accessibilityRole="header" className="mb-4 font-display text-display-lg text-ink">
        Save from Instagram DMs
      </Text>
      {content}
      <ConfirmDialog
        visible={confirmDisconnect}
        title="Disconnect Instagram?"
        message={`Reels you send to @${link?.handle ?? ""} won't be saved anymore. Everything you've saved stays.`}
        confirmLabel="Disconnect"
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </SubScreen>
  );
}
