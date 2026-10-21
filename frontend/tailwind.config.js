const { cssName, cssVariables, palettes } = require("./src/theme/tokens");

// Every token is a CSS variable: light values on :root, Espresso on .dark:root. NativeWind
// resolves them per colour scheme on native; on web the "dark" class on <html> switches them.
// Hex tokens keep Tailwind's opacity modifiers (rgb channels); rgba tokens are used as-is.
const colors = Object.fromEntries(
  Object.entries(palettes.light).map(([token, value]) => {
    const name = cssName(token);
    return [name, value.startsWith("#") ? `rgb(var(--color-${name}) / <alpha-value>)` : `var(--color-${name})`];
  }),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  // No className says "dark", so Tailwind would drop the .dark:root block below without this.
  safelist: ["dark"],
  presets: [require("nativewind/preset")],
  // "class": the app's Theme setting picks the scheme (ThemeProvider), not only the OS.
  darkMode: "class",
  theme: {
    extend: {
      colors,
      fontFamily: {
        // Bricolage Grotesque: screen, sheet and card titles; medium for the wordmark and
        // names; heavy for the sign-in wordmark and hero lines.
        display: ["BricolageGrotesque_700Bold"],
        "display-medium": ["BricolageGrotesque_600SemiBold"],
        "display-heavy": ["BricolageGrotesque_800ExtraBold"],
        // Only for reading-font samples (the reading font itself is set by usePreferences).
        newsreader: ["Newsreader_400Regular"],
        sans: ["Inter_400Regular"],
        "sans-medium": ["Inter_500Medium"],
        "sans-semibold": ["Inter_600SemiBold"],
        "sans-italic": ["Inter_400Regular_Italic"],
        lora: ["Lora_400Regular"],
      },
      fontSize: {
        // Phone scale: screen titles 26, sheet/section titles 22/20, card titles 14. Bricolage
        // runs wider and taller than a serif, so the display sizes carry tighter tracking.
        "display-lg": ["26px", { lineHeight: "31px", letterSpacing: "-0.6px" }],
        "display-md": ["22px", { lineHeight: "27px", letterSpacing: "-0.4px" }],
        "display-sm": ["19px", { lineHeight: "24px", letterSpacing: "-0.25px" }],
        title: ["14px", { lineHeight: "19px" }],
        body: ["15px", { lineHeight: "22px" }],
        meta: ["13px", { lineHeight: "18px" }],
        label: ["11px", { lineHeight: "14px", letterSpacing: "0.6px" }],
        caption: ["11px", { lineHeight: "14px" }],
      },
      borderRadius: {
        thumb: "14px",
        ctl: "12px",
        sheet: "24px",
      },
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        ":root": cssVariables(palettes.light),
        ".dark:root": cssVariables(palettes.dark),
      }),
  ],
};
