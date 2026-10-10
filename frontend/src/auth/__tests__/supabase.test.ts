const mockCreateClient = jest.fn((_url: string, _key: string, _opts: unknown) => ({ auth: {} }));
jest.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, opts: unknown) => mockCreateClient(url, key, opts),
}));
jest.mock("../../config", () => ({
  config: { apiMode: "live", apiUrl: "https://api.test", supabaseUrl: "https://x.supabase.co", supabaseKey: "pk" },
}));

import { getSupabase } from "../supabase";

test("the Supabase client uses the PKCE flow (no tokens in a custom-scheme redirect)", () => {
  getSupabase();
  const opts = mockCreateClient.mock.calls[0][2] as { auth: Record<string, unknown> };
  expect(opts.auth.flowType).toBe("pkce");
  expect(opts.auth.persistSession).toBe(true);
});
