const { colors } = require("./src/theme/tokens");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
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
        "display-lg": ["28px", { lineHeight: "34px" }],
        "display-md": ["24px", { lineHeight: "30px" }],
        "display-sm": ["22px", { lineHeight: "28px" }],
        title: ["15px", { lineHeight: "20px" }],
        body: ["15px", { lineHeight: "22px" }],
        meta: ["13px", { lineHeight: "18px" }],
        label: ["12px", { lineHeight: "16px", letterSpacing: "0.48px" }],
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
