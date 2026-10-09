import * as Linking from "expo-linking";

/**
 * Where Supabase sends people back after Google or an email link:
 * `exp://<lan-ip>:8081/--/auth-callback` in Expo Go, `lately://auth-callback` in a build,
 * `<origin>/auth-callback` on web. Every form must be on the Supabase redirect allow list.
 */
export function authRedirectUrl(): string {
  return Linking.createURL("auth-callback");
}

export interface AuthRedirectParams {
  access_token?: string;
  refresh_token?: string;
  code?: string;
  token_hash?: string;
  type?: string;
  error?: string;
  error_code?: string;
  error_description?: string;
}

/**
 * The sign-in result carried by a redirect URL: tokens in the #fragment (implicit flow),
 * a ?code (PKCE) or a ?token_hash (email link), or an error from Supabase.
 */
export function authParamsFromUrl(url: string): AuthRedirectParams {
  const out: Record<string, string> = {};
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt < 0 ? "" : beforeHash.slice(queryAt + 1);
  for (const part of [query, hash]) {
    for (const pair of part.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
      out[key] = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    }
  }
  return out;
}

/** True when the URL is a sign-in redirect (not just any deep link into the app). */
export function isAuthRedirect(url: string): boolean {
  const p = authParamsFromUrl(url);
  return !!(p.access_token || p.code || p.token_hash || p.error_description || p.error);
}
