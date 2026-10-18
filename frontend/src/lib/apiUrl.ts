import Constants from "expo-constants";
import { Platform, TurboModuleRegistry, type TurboModule } from "react-native";

import { config } from "../config";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * In development a `localhost` API URL means "the dev machine". A phone running the app
 * from Metro (Expo Go or a dev build) can't reach its own localhost, so the API host is
 * swapped for the host Metro served the app from (`devHost`, e.g. "192.168.1.5:8081"),
 * keeping the API's scheme, port and path. No more typing the PC's Wi-Fi IP into .env.
 * Release builds have no Metro host and must use https (release-env.js), so they are
 * never rewritten.
 */
export function resolveApiUrl(configured: string, devHost: string | null | undefined): string {
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return configured;
  }
  const host = devHost?.trim().replace(/:\d+$/, "");
  if (LOOPBACK.has(url.hostname) && host && !LOOPBACK.has(host)) {
    url.hostname = host;
  }
  return url.toString().replace(/\/$/, "");
}

/** Metro's host for this run of the app, if it was loaded from a dev server. */
function devServerHost(): string | null {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" ? window.location.hostname : null;
  }
  return Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? bundleHost();
}

interface SourceCodeModule extends TurboModule {
  getConstants(): { scriptURL?: string | null };
}

/**
 * A plain debug build (no Expo dev client) may have no Metro host in expo-constants, but
 * its JS bundle URL names it. Read through the public TurboModuleRegistry: the old
 * `react-native/Libraries/Core/Devtools/getDevServer` deep import raised a dev warning bar
 * that sat over the bottom of every sheet. Development only; release bundles are embedded.
 */
function bundleHost(): string | null {
  if (!__DEV__) return null;
  try {
    const scriptURL = TurboModuleRegistry.get<SourceCodeModule>("SourceCode")?.getConstants().scriptURL;
    return scriptURL && /^https?:\/\//.test(scriptURL) ? new URL(scriptURL).host : null;
  } catch {
    return null;
  }
}

/** The API base URL this app instance calls. */
export function apiBaseUrl(): string {
  return resolveApiUrl(config.apiUrl, devServerHost());
}
