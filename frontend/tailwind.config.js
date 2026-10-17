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
        display: ["Newsreader_600SemiBold"],
        "display-medium": ["Newsreader_500Medium"],
        "display-regular": ["Newsreader_400Regular"],
        "display-italic": ["Newsreader_400Regular_Italic"],
        sans: ["Inter_400Regular"],
        "sans-medium": ["Inter_500Medium"],
        "sans-semibold": ["Inter_600SemiBold"],
        "sans-italic": ["Inter_400Regular_Italic"],
        lora: ["Lora_400Regular"],
      },
      fontSize: {
        // Phone scale: screen titles 26, sheet/section titles 22/20, card titles 14.
        "display-lg": ["26px", { lineHeight: "32px", letterSpacing: "-0.26px" }],
        "display-md": ["22px", { lineHeight: "28px", letterSpacing: "-0.11px" }],
        "display-sm": ["19px", { lineHeight: "25px" }],
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
