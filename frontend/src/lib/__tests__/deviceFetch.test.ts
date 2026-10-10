import type { LatelyApi, SaveResult } from "../../api/contract";
import { EMBED_HEADERS, embedUrl, fetchEmbedHint, parseEmbedPage, sendDeviceHint } from "../deviceFetch";

// Jest runs on Node; the app's tsconfig has no Node types, so declare the two calls used here.
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync } = require("fs") as { readFileSync(path: string, encoding: "utf8"): string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require("path") as { join(...parts: string[]): string };

// The same saved embed page the backend parser is tested against (backend/tests/enrich/fixtures).
const FIXTURE = readFileSync(join(__dirname, "../../../../backend/tests/enrich/fixtures/embed_captioned.html"), "utf8");

const SAVED: SaveResult = { reel_id: "r1", deduped: false, status: "pending" };
const LINK = "https://www.instagram.com/reel/C8xYz12/?igsh=abc";

function htmlFetch(body: string, status = 200) {
  return jest.fn(async (_url: string, _init?: RequestInit) => ({ ok: status === 200, status, text: async () => body }) as Response);
}

function fakeApi() {
  return { sendHint: jest.fn(async () => {}) } as unknown as Pick<LatelyApi, "sendHint"> & { sendHint: jest.Mock };
}

describe("parseEmbedPage (port of backend parse_embed_page)", () => {
  test("extracts caption, creator, thumbnail, video and duration", () => {
    const h = parseEmbedPage(FIXTURE)!;
    expect(h.creator_handle).toBe("delhi.foodtrails");
    expect(h.caption!.startsWith("Best momos in Majnu ka Tilla 🥟 laphing + jhol momos for ₹120")).toBe(true);
    expect(h.caption).toContain("Open 11am–10pm, closed Tuesdays");
    expect(h.caption).toContain("#delhifood #momos #majnukatilla");
    expect(h.caption).not.toContain("View all");
    expect(h.caption).not.toContain("delhi.foodtrails");
    expect(h.thumbnail_url!.startsWith("https://scontent-del1-1.cdninstagram.com/v/t51.29350-15/")).toBe(true);
    expect(h.thumbnail_url).toContain("&_nc_ht="); // entities decoded
    expect(h.video_url!.startsWith("https://scontent-del1-1.cdninstagram.com/o1/v/t16/")).toBe(true);
    expect(
      h.video_url!.endsWith(".mp4?efg=eyJ2ZW5jb2RlX3RhZyI6InZ0c192b2RfdXJsZ2VuIn0&_nc_ht=scontent-del1-1.cdninstagram.com&oh=00_AYDvid"),
    ).toBe(true);
    expect(h.duration_s).toBeCloseTo(47.3);
  });

  test("a login wall or error shell is null", () => {
    expect(parseEmbedPage("<html><body><div class='LoginPrompt'>Log in</div></body></html>")).toBeNull();
    expect(parseEmbedPage("")).toBeNull();
  });

  test("fields the server would refuse are left out", () => {
    const long = "x".repeat(6000);
    const html = `<div class="Caption"><a class="CaptionUsername">not a handle!</a>${long}</div>"video_duration":9999`;
    const h = parseEmbedPage(html)!;
    expect(h.caption).toHaveLength(5000);
    expect(h.creator_handle).toBeUndefined();
    expect(h.duration_s).toBeUndefined();
  });
});

describe("fetchEmbedHint", () => {
  test("GETs the captioned embed page with the desktop iframe headers", async () => {
    const f = htmlFetch(FIXTURE);
    const h = await fetchEmbedHint("C8xYz12", { fetchImpl: f as unknown as typeof fetch });
    expect(f.mock.calls[0][0]).toBe("https://www.instagram.com/p/C8xYz12/embed/captioned/");
    expect(embedUrl("C8xYz12")).toBe("https://www.instagram.com/p/C8xYz12/embed/captioned/");
    expect(f.mock.calls[0][1]?.headers).toEqual(EMBED_HEADERS);
    expect(EMBED_HEADERS["User-Agent"]).toContain("Windows NT 10.0");
    expect(EMBED_HEADERS["Sec-Fetch-Dest"]).toBe("iframe");
    expect(h?.creator_handle).toBe("delhi.foodtrails");
  });

  test("an HTTP error is null", async () => {
    expect(await fetchEmbedHint("C8xYz12", { fetchImpl: htmlFetch("", 429) as unknown as typeof fetch })).toBeNull();
  });

  test("gives up after the timeout", async () => {
    jest.useFakeTimers();
    try {
      const hang = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const p = fetchEmbedHint("C8xYz12", { fetchImpl: hang as unknown as typeof fetch, timeoutMs: 6000 });
      jest.advanceTimersByTime(6001);
      expect(await p).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("sendDeviceHint", () => {
  const run = (o: Partial<Parameters<typeof sendDeviceHint>[0]> = {}) => {
    const api = fakeApi();
    const f = htmlFetch(FIXTURE);
    const p = sendDeviceHint({
      api,
      mode: "live",
      platform: "android",
      text: LINK,
      result: SAVED,
      fetchImpl: f as unknown as typeof fetch,
      ...o,
    });
    return { api, f, p };
  };

  test("reads the embed page on the device and posts the hint for the save", async () => {
    const { api, p } = run();
    expect(await p).toBe("sent");
    expect(api.sendHint).toHaveBeenCalledTimes(1);
    const [id, hint] = api.sendHint.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(id).toBe("r1");
    expect(hint).toMatchObject({ shortcode: "C8xYz12", creator_handle: "delhi.foodtrails" });
    expect(Object.keys(hint).sort()).toEqual(["caption", "creator_handle", "duration_s", "shortcode", "thumbnail_url", "video_url"]);
  });

  test("demo mode never touches Instagram or the API", async () => {
    const { api, f, p } = run({ mode: "demo" });
    expect(await p).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
    expect(api.sendHint).not.toHaveBeenCalled();
  });

  test.each([
    ["a share link (shortcode unknown until the server resolves it)", { text: "https://www.instagram.com/share/reel/BAbc123/" }],
    ["no reel link", { text: "hello" }],
    ["a deduped save", { result: { ...SAVED, deduped: true } }],
    ["the web build (no User-Agent, CORS)", { platform: "web" }],
  ])("skipped for %s", async (_label, o) => {
    const { api, f, p } = run(o as Partial<Parameters<typeof sendDeviceHint>[0]>);
    expect(await p).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
    expect(api.sendHint).not.toHaveBeenCalled();
  });

  test("an unreadable page sends nothing", async () => {
    const { api, p } = run({ fetchImpl: htmlFetch("<html>login</html>") as unknown as typeof fetch });
    expect(await p).toBe("failed");
    expect(api.sendHint).not.toHaveBeenCalled();
  });

  test("never rejects: network and API errors are swallowed", async () => {
    const boom = jest.fn(async () => {
      throw new Error("offline");
    });
    expect(await run({ fetchImpl: boom as unknown as typeof fetch }).p).toBe("failed");

    const api = { sendHint: jest.fn(async () => Promise.reject(new Error("500"))) };
    expect(await run({ api }).p).toBe("failed");
  });
});
