import { extractReelUrl, readInstagramLink } from "../instagram";

test("pulls the reel link out of shared text and drops tracking params", () => {
  expect(extractReelUrl("Look https://www.instagram.com/reel/C8xYz12/?igsh=abc 🔥")).toEqual({
    url: "https://www.instagram.com/reel/C8xYz12/",
    shortcode: "C8xYz12",
  });
});

test("accepts /reels/ links without a scheme", () => {
  expect(extractReelUrl("instagram.com/reels/AbC_1-2")?.shortcode).toBe("AbC_1-2");
});

test("/share/ links are saveable, but only the server knows their reel", () => {
  expect(readInstagramLink("https://instagram.com/share/reel/XyZ?igsh=abc")).toEqual({
    kind: "share",
    url: "https://www.instagram.com/share/reel/XyZ",
    shortcode: null,
  });
  expect(readInstagramLink("look instagram.com/share/BAbc_12/")).toEqual({
    kind: "share",
    url: "https://www.instagram.com/share/BAbc_12/",
    shortcode: null,
  });
  // No shortcode to read the reel by: the device read skips these.
  expect(extractReelUrl("https://instagram.com/share/reel/XyZ")).toBeNull();
});

test("a link typed without https:// is read like the full one", () => {
  expect(readInstagramLink("instagram.com/reel/C8xYz12")).toEqual({
    kind: "reel",
    url: "https://www.instagram.com/reel/C8xYz12/",
    shortcode: "C8xYz12",
  });
});

test.each([
  ["a permalink with the username", "https://www.instagram.com/natgeo/reel/Abc123/", "https://www.instagram.com/reel/Abc123/"],
  ["a post permalink", "https://www.instagram.com/natgeo/p/Post99/", "https://www.instagram.com/p/Post99/"],
  ["an IGTV link", "https://www.instagram.com/tv/Tv1/", "https://www.instagram.com/reel/Tv1/"],
])("accepts %s", (_label, text, url) => {
  expect(readInstagramLink(text)).toMatchObject({ kind: "reel", url });
});

test.each([
  ["a profile", "https://www.instagram.com/someprofile/"],
  ["a story", "https://www.instagram.com/stories/someprofile/3141592653/"],
  ["an audio page", "https://www.instagram.com/reels/audio/123456/"],
  ["the explore page", "instagram.com/explore/"],
])("%s is an Instagram link, but not a reel or post", (_label, text) => {
  expect(readInstagramLink(text)?.kind).toBe("not_reel");
  expect(extractReelUrl(text)).toBeNull();
});

test("the first reel or post link wins over an earlier profile link", () => {
  expect(readInstagramLink("by instagram.com/natgeo : https://www.instagram.com/reel/R1/")).toMatchObject({
    kind: "reel",
    shortcode: "R1",
  });
});

test.each([
  ["another site's path", "https://evil.com/instagram.com/reel/X1/"],
  ["a longer host name", "https://notinstagram.com/reel/X1/"],
  ["a subdomain", "https://m.instagram.com/reel/X1/"],
])("not an Instagram link: %s", (_label, text) => {
  expect(readInstagramLink(text)).toBeNull();
});

test("keeps /p/ posts as posts", () => {
  expect(extractReelUrl("https://www.instagram.com/p/Post99/")?.url).toBe(
    "https://www.instagram.com/p/Post99/",
  );
});

test("rejects profiles and plain text", () => {
  expect(extractReelUrl("https://www.instagram.com/someprofile/")).toBeNull();
  expect(extractReelUrl("hello")).toBeNull();
  expect(readInstagramLink("hello")).toBeNull();
});
