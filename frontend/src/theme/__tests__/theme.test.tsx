import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { createMemoryStore } from "../../test/memoryStore";
import { CATEGORY, categoryColor } from "../categories";
import { getThemePreference, loadThemePreference, setThemePreference, THEME_KEY } from "../preference";
import { resolveScheme, ThemeProvider, useTheme } from "../ThemeProvider";
import { cssVariables, palettes } from "../tokens";

const appJson = require("../../../app.json");

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

afterEach(() => setThemePreference("light", createMemoryStore()));

describe("Espresso palette", () => {
  const dark = palettes.dark;

  test("defines every token the light palette has", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });

  test.each(["ink", "ink2", "ink3", "accentText", "danger", "success"] as const)(
    "%s text clears 4.5:1 on canvas, card and raised",
    (token) => {
      for (const surface of ["canvas", "card", "raised"] as const) {
        expect(contrast(dark[token], dark[surface])).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  test("labels on marigold and on the danger tint stay readable", () => {
    expect(contrast(dark.onAccent, dark.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.danger, dark.dangerSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.ink, dark.warm)).toBeGreaterThanOrEqual(4.5);
  });

  test("category dots keep 3:1 against espresso cards", () => {
    for (const c of Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]) {
      expect(contrast(categoryColor(c, "dark"), dark.card)).toBeGreaterThanOrEqual(3);
    }
  });

  test("CSS variables carry rgb channels for hex tokens and rgba as-is", () => {
    const vars = cssVariables(dark);
    expect(vars["--color-canvas"]).toBe("21 18 15");
    expect(vars["--color-ink-2"]).toBe("176 165 151");
    expect(vars["--color-accent-text"]).toBe("240 174 74");
    expect(vars["--color-scrim-light"]).toBe(dark.scrimLight);
  });

  test("the splash screen matches the canvas of each theme", () => {
    const [, splash] = appJson.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-splash-screen");
    expect(splash.backgroundColor).toBe(palettes.light.canvas);
    expect(splash.dark.backgroundColor).toBe(palettes.dark.canvas);
    expect(appJson.expo.userInterfaceStyle).toBe("automatic");
  });
});

describe("theme preference", () => {
  test("system follows the OS; light and dark ignore it", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
    expect(resolveScheme("light", "dark")).toBe("light");
  });

  test("the stored theme is read at startup; junk falls back to light", async () => {
    const store = createMemoryStore();
    await store.setItem(THEME_KEY, "dark");
    await loadThemePreference(store);
    expect(getThemePreference()).toBe("dark");

    setThemePreference("light", store);
    await store.setItem(THEME_KEY, "sepia");
    await loadThemePreference(store);
    expect(getThemePreference()).toBe("light");
  });

  test("a new pick is saved on the phone", async () => {
    const store = createMemoryStore();
    setThemePreference("system", store);
    expect(await store.getItem(THEME_KEY)).toBe("system");
  });

  test("ThemeProvider hands out the active palette and re-renders on a change", async () => {
    function Probe() {
      const { scheme, colors } = useTheme();
      return <Text>{`${scheme} ${colors.canvas}`}</Text>;
    }
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText(`light ${palettes.light.canvas}`)).toBeTruthy();
    await act(async () => setThemePreference("dark", createMemoryStore()));
    expect(screen.getByText(`dark ${palettes.dark.canvas}`)).toBeTruthy();
  });
});
