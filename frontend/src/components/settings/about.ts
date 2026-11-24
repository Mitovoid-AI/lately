// What Account's footer and "Report a problem" say about this copy of the app.
import Constants from "expo-constants";
import { Platform } from "react-native";

/** Where problems go when the build has no support address. */
export const ISSUES_URL = "https://github.com/Mitovoid-AI/lately/issues/new";

/** Set at build time (Expo inlines EXPO_PUBLIC_* by full name); empty = report on GitHub instead. */
const SUPPORT_EMAIL = (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "").trim();

/** "Lately 1.0.0 (build 11)": the version, plus the Android versionCode testers quote; just the version elsewhere. */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const build = Platform.OS === "android" ? Constants.expoConfig?.android?.versionCode : undefined;
  return typeof build === "number" ? `Lately ${version} (build ${build})` : `Lately ${version}`;
}

/** An email to the support address with the version filled in, or the GitHub page for a new issue. */
export function reportProblemUrl(email: string = SUPPORT_EMAIL): string {
  if (!email) return ISSUES_URL;
  const subject = encodeURIComponent("A problem with Lately");
  const body = encodeURIComponent(`\n\n---\n${appVersionLabel()}, ${Platform.OS} ${Platform.Version}`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function supportEmail(): string {
  return SUPPORT_EMAIL;
}
