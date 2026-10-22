import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import type { CuratedFeed, LatelyApi, Save } from "../../../api/contract";
import { demoApi, renderWithProviders } from "../../../test/render";
import { BackForYou, memoriesFrom } from "../BackForYou";

/** A ready save with a picture; enough for a tile. */
function save(id: string, over: Partial<Save> = {}): Save {
  return {
    id,
    source_url: `https://www.instagram.com/reel/${id}/`,
    shortcode: id,
    status: "enriched",
    note: null,
    created_at: "2026-09-01T10:00:00.000Z",
    title: `Title ${id}`,
    caption: null,
    category: "Food & Places",
    thumbnail_url: `https://img.example/${id}.jpg`,
    creator: null,
    channel: "app_share",
    ...over,
  };
}

function feed(over: Partial<CuratedFeed> = {}): CuratedFeed {
  return {
    date_label: "Sun, Oct 4",
    hero: {
      label: "THIS WEEKEND",
      title: "3 cafes you saved",
      subtitle: "Food & Places",
      image_url: "https://img.example/hero.jpg",
      save_ids: ["h1", "h2", "h3"],
      query: "cafe",
    },
    sections: [
      { kind: "row", title: "Recently saved", subtitle: null, saves: [save("r1"), save("r2")] },
      { kind: "row", title: "Revisit · Fitness", subtitle: null, saves: [save("f1"), save("f2")] },
    ],
    ...over,
  };
}

describe("memoriesFrom", () => {
  test("the hero comes first, then saves from sections that are real memories", () => {
    const tiles = memoriesFrom(feed());
    expect(tiles.map((t) => t.key)).toEqual(["hero", "f1", "f2"]);
    expect(tiles[0]).toMatchObject({ title: "3 cafes you saved", kicker: "This weekend", href: "/search?q=cafe" });
    expect(tiles[1]).toMatchObject({ kicker: "Revisit · Fitness", href: "/reel/f1" });
  });

  test("sections that only repeat the grid are skipped", () => {
    const keys = memoriesFrom(feed()).map((t) => t.key);
    expect(keys).not.toContain("r1");
  });

  test("a hero of one save opens that card", () => {
    const f = feed();
    f.hero.save_ids = ["only"];
    expect(memoriesFrom(f)[0].href).toBe("/reel/only");
  });

  test("a hero group without a query opens Curated", () => {
    const f = feed();
    f.hero.query = "";
    expect(memoriesFrom(f)[0].href).toBe("/curated");
  });

  test("saves without a picture, pending ones and repeats of the hero are left out", () => {
    const f = feed({
      sections: [
        {
          kind: "row",
          title: "Revisit · Fitness",
          subtitle: null,
          saves: [
            save("a", { thumbnail_url: null }),
            save("b", { status: "pending" }),
            save("h1"),
            save("c"),
            save("d"),
          ],
        },
      ],
    });
    expect(memoriesFrom(f).map((t) => t.key)).toEqual(["hero", "c", "d"]);
  });

  test("at most six tiles", () => {
    const many = Array.from({ length: 10 }, (_, i) => save(`m${i}`));
    const f = feed({ sections: [{ kind: "row", title: "Revisit · Fitness", subtitle: null, saves: many }] });
    expect(memoriesFrom(f)).toHaveLength(6);
  });

  test("fewer than three is no row at all", () => {
    const f = feed({ sections: [{ kind: "row", title: "Revisit · Fitness", subtitle: null, saves: [save("x")] }] });
    expect(memoriesFrom(f)).toEqual([]);
  });

  test("an empty hero (no saves yet) and no sections is nothing", () => {
    const f = feed({ sections: [] });
    f.hero = { ...f.hero, image_url: null, save_ids: [] };
    expect(memoriesFrom(f)).toEqual([]);
    expect(memoriesFrom(undefined)).toEqual([]);
  });
});

describe("the row", () => {
  test("shows the tiles from the demo feed; tiles and See all navigate", async () => {
    const onOpen = jest.fn();
    const onSeeAll = jest.fn();
    await renderWithProviders(<BackForYou onOpen={onOpen} onSeeAll={onSeeAll} />);
    expect(await screen.findByText("Back for you")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "See all picks" }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
    // The hero pick is the first tile: a group of cafes opens the search that lists them.
    await fireEvent.press(screen.getAllByRole("button")[1]);
    expect(onOpen).toHaveBeenCalledWith("/search?q=cafe");
  });

  test("a failed feed shows nothing, not an error", async () => {
    const getCurated = jest.fn(() => Promise.reject(new Error("down")));
    const api: LatelyApi = { ...demoApi(), getCurated };
    await renderWithProviders(<BackForYou onOpen={() => {}} onSeeAll={() => {}} />, { api });
    // Loading shows only skeleton shapes; once the request fails the block is simply gone.
    await waitFor(() => expect(getCurated).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Back for you")).toBeNull();
    expect(screen.queryByText("Try again")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("an empty feed shows nothing", async () => {
    const base = demoApi();
    const real = await base.getCurated();
    const empty: CuratedFeed = { ...real, sections: [], hero: { ...real.hero, save_ids: [], image_url: null } };
    const getCurated = jest.fn(async () => empty);
    await renderWithProviders(<BackForYou onOpen={() => {}} onSeeAll={() => {}} />, { api: { ...base, getCurated } });
    await waitFor(() => expect(getCurated).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Back for you")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
