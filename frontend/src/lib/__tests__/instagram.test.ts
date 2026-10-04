import { extractReelUrl } from "../instagram";

test("pulls the reel link out of shared text and drops tracking params", () => {
  expect(extractReelUrl("Look https://www.instagram.com/reel/C8xYz12/?igsh=abc 🔥")).toEqual({
    url: "https://www.instagram.com/reel/C8xYz12/",
    shortcode: "C8xYz12",
  });
});

test("accepts /reels/ links without a scheme", () => {
  expect(extractReelUrl("instagram.com/reels/AbC_1-2")?.shortcode).toBe("AbC_1-2");
});

test("accepts /share/reel/ links", () => {
  expect(extractReelUrl("https://instagram.com/share/reel/XyZ")?.shortcode).toBe("XyZ");
});

test("keeps /p/ posts as posts", () => {
  expect(extractReelUrl("https://www.instagram.com/p/Post99/")?.url).toBe(
    "https://www.instagram.com/p/Post99/",
  );
});

test("rejects profiles and plain text", () => {
  expect(extractReelUrl("https://www.instagram.com/someprofile/")).toBeNull();
  expect(extractReelUrl("hello")).toBeNull();
});
