const { colors } = require("./src/theme/tokens");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // Light-only app; "class" lets the navigator set the color scheme without NativeWind throwing.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: colors.canvas,
        card: colors.card,
        raised: colors.raised,
        hairline: colors.hairline,
        ink: colors.ink,
        "ink-2": colors.ink2,
        "ink-3": colors.ink3,
        accent: colors.accent,
        "on-accent": colors.onAccent,
        "accent-pressed": colors.accentPressed,
        success: colors.success,
        danger: colors.danger,
        "danger-soft": colors.dangerSoft,
      },
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
  plugins: [],
};
