import FontAwesome from "@expo/vector-icons/FontAwesome";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Preferences } from "../api/contract";
import { useApi } from "../api/index";
import { useAuth } from "../auth/AuthProvider";
import { LOGO } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { OptionCard } from "../components/settings/OptionCard";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { useToast } from "../components/Toast";
import { usePreferences } from "../hooks/usePreferences";
import { useMe } from "../hooks/useSaves";
import { monthYear } from "../lib/dates";
import { colors } from "../theme/tokens";

const SIZES: { size: Preferences["text_size"]; name: string }[] = [
  { size: 14, name: "Small" },
  { size: 16, name: "Default" },
  { size: 18, name: "Large" },
  { size: 20, name: "Extra large" },
];

function InfoChip({ icon, text, tone = "plain" }: { icon: IconName; text: string; tone?: "plain" | "warm" }) {
  return (
    <View className={`h-8 flex-row items-center rounded-full px-3 ${tone === "warm" ? "bg-[#EFE3D3]" : "bg-raised"}`}>
      <Icon name={icon} size={16} color={tone === "warm" ? colors.accent : colors.ink2} />
      <Text className="ml-1.5 font-sans-medium text-meta text-ink">{text}</Text>
    </View>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      className={`h-6 w-6 items-center justify-center rounded-md border-2 ${checked ? "border-accent bg-accent" : "border-hairline bg-card"}`}
    >
      {checked ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
    </View>
  );
}

export function AccountScreen() {
  const router = useRouter();
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const { prefs, update } = usePreferences();

  const live = auth.mode === "live";
  const name = (live ? auth.user?.name : me?.name) ?? me?.name ?? "";
  const email = (live ? auth.user?.email : me?.email) ?? "";
  const handle = me?.handle ?? email.split("@")[0];
  const avatar = (live ? auth.user?.avatarUrl : me?.avatar_url) ?? null;
  const instagram = me?.connected_accounts.find((a) => a.provider === "instagram");
  const sizeName = SIZES.find((s) => s.size === prefs.text_size)?.name ?? "Default";
  const version = Constants.expoConfig?.version ?? "1.0.0";

  async function exportArchive() {
    try {
      await api.requestExport();
      toast.show("We'll email your archive when it's ready");
    } catch {
      toast.show("Couldn't start the export. Try again.");
    }
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center border-b border-hairline px-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-12 w-12 items-center justify-center">
          <Icon name="arrow-back" size={24} color={colors.ink} />
        </Pressable>
        <Image source={LOGO} style={{ width: 36, height: 36, borderRadius: 10 }} />
        <View className="ml-2 flex-1">
          <Text className="font-sans-semibold text-caption text-ink-2">LATELY</Text>
          <Text className="font-display text-display-sm text-ink" style={{ lineHeight: 24 }}>
            Account and Settings
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View className="w-full max-w-[560px] self-center px-4">
          <View className="items-center pt-6">
            <View>
              {avatar ? (
                <Image source={{ uri: avatar }} style={{ width: 112, height: 112, borderRadius: 56, borderWidth: 4, borderColor: "#FFFEFB" }} />
              ) : (
                <View className="h-28 w-28 items-center justify-center rounded-full bg-raised">
                  <Text className="font-display text-display-lg text-ink">{name[0] ?? "?"}</Text>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change photo"
                onPress={() => toast.show("Photo upload is coming soon")}
                className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-2 border-canvas bg-accent"
              >
                <Icon name="photo-camera" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text className="mt-4 font-display-medium text-display-lg text-ink">{name}</Text>
            <Text className="mt-1 font-sans text-body text-ink-2">{`@${handle} · ${email}`}</Text>
            {me ? (
              <>
                <View className="mt-4 flex-row flex-wrap justify-center gap-2">
                  <InfoChip icon="bookmark-border" text={`${me.total_saves} Saved Reels`} />
                  <InfoChip icon="folder-open" text={`${me.stacks_count} Collections`} />
                </View>
                <View className="mt-2">
                  <InfoChip icon="verified" text={`Vault Member (${monthYear(me.member_since)})`} tone="warm" />
                </View>
              </>
            ) : null}
            {instagram ? (
              <View className="mt-3 h-9 flex-row items-center rounded-full bg-raised px-3">
                <View className="h-2 w-2 rounded-full bg-success" />
                <FontAwesome name="instagram" size={16} color={colors.ink2} style={{ marginLeft: 8 }} />
                <Text className="mx-1.5 font-sans-medium text-meta text-ink">{`Connected to ${instagram.label}`}</Text>
                <Icon name="check-circle-outline" size={16} color={colors.ink2} />
              </View>
            ) : null}
          </View>

          <SettingsSection icon="menu-book" title="Reading Experience & Appearance">
            <Text className="font-sans-semibold text-body text-ink">Reading Font</Text>
            <Text className="font-sans text-meta text-ink-2">Serif or Sans for summaries & notes</Text>
            <View className="mt-3 flex-row gap-2">
              <OptionCard
                selected={prefs.reading_font === "newsreader"}
                onPress={() => update({ reading_font: "newsreader" })}
                top={<Text numberOfLines={1} className="text-center font-display-regular text-ink" style={{ fontSize: 16 }}>Newsreader</Text>}
                label="Default"
              />
              <OptionCard
                selected={prefs.reading_font === "inter"}
                onPress={() => update({ reading_font: "inter" })}
                top={<Text className="text-center font-sans text-ink" style={{ fontSize: 16 }}>Inter</Text>}
                label="Modern"
              />
              <OptionCard
                selected={prefs.reading_font === "lora"}
                onPress={() => update({ reading_font: "lora" })}
                top={<Text className="text-center font-lora italic text-ink" style={{ fontSize: 16 }}>Lora</Text>}
                label="Classic"
              />
            </View>

            <View className="mt-6 flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="font-sans-semibold text-body text-ink">Text Size</Text>
                <Text className="font-sans text-meta text-ink-2">Adjust editorial text scale</Text>
              </View>
              <View className="rounded-full border border-hairline bg-canvas px-3 py-1">
                <Text className="font-sans-medium text-meta text-ink">{`${sizeName} (${prefs.text_size}px)`}</Text>
              </View>
            </View>
            <View className="mt-4 flex-row items-center">
              <Text className="font-display-regular text-ink-2" style={{ fontSize: 18 }}>A</Text>
              <View className="mx-3 h-8 flex-1 justify-center">
                <View className="h-1.5 rounded-full bg-raised" />
                <View className="absolute inset-0 flex-row items-center justify-between">
                  {SIZES.map((s) => (
                    <Pressable
                      key={s.size}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.size}px`}
                      onPress={() => update({ text_size: s.size })}
                      className="h-8 w-8 items-center justify-center"
                    >
                      <View
                        className={`rounded-full ${prefs.text_size === s.size ? "h-5 w-5 bg-[#7A4A00]" : "h-2.5 w-2.5 bg-hairline"}`}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text className="font-display-regular text-ink" style={{ fontSize: 28 }}>A</Text>
            </View>
            <View className="mt-1 flex-row justify-between px-5">
              {SIZES.map((s) => (
                <Pressable key={s.size} onPress={() => update({ text_size: s.size })}>
                  <Text className="font-sans text-caption text-ink-2">{`${s.size}px`}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="mt-6 font-sans-semibold text-body text-ink">Theme & Appearance</Text>
            <Text className="font-sans text-meta text-ink-2">Choose your color experience</Text>
            <View className="mt-3 flex-row gap-2">
              {(
                [
                  { theme: "light", icon: "light-mode", title: "Light", label: "Warm Cream" },
                  { theme: "dark", icon: "dark-mode", title: "Dark", label: "Espresso" },
                  { theme: "system", icon: "brightness-medium", title: "System", label: "Auto matches" },
                ] as const
              ).map((t) => (
                <OptionCard
                  key={t.theme}
                  check
                  selected={prefs.theme === t.theme}
                  onPress={() => update({ theme: t.theme })}
                  top={
                    <View>
                      <Icon name={t.icon} size={20} color={prefs.theme === t.theme ? colors.accent : colors.ink2} />
                      <Text className="mt-2 font-sans-medium text-body text-ink">{t.title}</Text>
                    </View>
                  }
                  label={t.label}
                />
              ))}
            </View>
            {prefs.theme !== "light" ? (
              <Text className="mt-3 font-sans text-meta text-ink-2">
                Dark theme is coming soon — Lately stays light for now.
              </Text>
            ) : null}
          </SettingsSection>

          <SettingsSection icon="shield" title="Account & Security">
            <SettingsRow
              icon="lock-outline"
              title="Password & Security"
              subtitle="Last changed 3 months ago"
              onPress={() => toast.show("Password reset is coming soon")}
              right={
                <View className="flex-row items-center">
                  <Text className="font-sans-semibold text-meta text-accent">Reset</Text>
                  <Icon name="chevron-right" size={20} color={colors.ink2} />
                </View>
              }
            />
            <SettingsRow icon="link" title="Connected Accounts" subtitle="Sync services & authenticators" divider>
              <View className="ml-14 mt-3 gap-2">
                {(me?.connected_accounts ?? []).map((a) => (
                  <View key={a.provider} className="h-11 flex-row items-center rounded-xl bg-raised px-3">
                    {a.provider === "instagram" ? (
                      <FontAwesome name="instagram" size={16} color={colors.ink2} />
                    ) : (
                      <Icon name="mail-outline" size={16} color={colors.ink2} />
                    )}
                    <Text numberOfLines={1} className="ml-2 flex-1 font-sans-medium text-meta text-ink">
                      {`${a.provider === "instagram" ? "Instagram" : "Google"} (${a.label})`}
                    </Text>
                    <Text className="font-sans-medium text-meta text-success">
                      {a.status === "active" ? "Active" : "Secured"}
                    </Text>
                  </View>
                ))}
              </View>
            </SettingsRow>
            <SettingsRow
              icon="cloud-download"
              title="Download Vault Archive"
              subtitle="Export all reels & notes as JSON or Markdown"
              onPress={exportArchive}
              right={<Icon name="chevron-right" size={20} color={colors.ink2} />}
              divider
            />
          </SettingsSection>

          <SettingsSection icon="tune" title="Reading Preferences">
            <SettingsRow
              icon="notifications-none"
              title="Push Digests"
              subtitle="Weekly summaries of your curated reels"
              onPress={() => update({ push_digests: !prefs.push_digests })}
              right={<Checkbox checked={prefs.push_digests} />}
            />
            <SettingsRow
              icon="offline-pin"
              title="Offline Reading Storage"
              subtitle="Keep recent transcripts ready offline"
              onPress={() => update({ offline_reading: !prefs.offline_reading })}
              right={<Checkbox checked={prefs.offline_reading} />}
              divider
            />
          </SettingsSection>

          <Pressable
            accessibilityRole="button"
            onPress={() => auth.signOut()}
            className="mt-8 flex-row items-center justify-center rounded-2xl bg-danger-soft px-4 py-5 active:opacity-80"
          >
            <Icon name="logout" size={22} color={colors.danger} />
            <View className="ml-3">
              <Text className="font-sans-semibold text-body text-danger">Log Out of Lately</Text>
              <Text className="font-sans text-meta text-danger">Session will safely end on this device</Text>
            </View>
          </Pressable>

          <View className="mt-8 items-center">
            <Image source={LOGO} style={{ width: 28, height: 28, borderRadius: 8 }} />
            <Text className="mt-2 font-sans text-meta text-ink-2">{`Lately for iOS & Web v${version}`}</Text>
            <Text className="font-sans text-meta text-ink-3">Made for mindful reading & quiet curation</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
