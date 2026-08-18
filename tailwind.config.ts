import type { Config } from "tailwindcss";

/**
 * ink/accentはCSS変数経由の色トークン(globals.cssの:root / .darkで定義)。
 * "rgb(var(--x) / <alpha-value>)" 形式にすることで、bg-ink-50/60のような
 * Tailwindの不透明度修飾子もそのまま使える。
 */
function themedColor(name: string) {
  return {
    50: `rgb(var(--${name}-50) / <alpha-value>)`,
    100: `rgb(var(--${name}-100) / <alpha-value>)`,
    200: `rgb(var(--${name}-200) / <alpha-value>)`,
    300: `rgb(var(--${name}-300) / <alpha-value>)`,
    400: `rgb(var(--${name}-400) / <alpha-value>)`,
    500: `rgb(var(--${name}-500) / <alpha-value>)`,
    600: `rgb(var(--${name}-600) / <alpha-value>)`,
    700: `rgb(var(--${name}-700) / <alpha-value>)`,
    800: `rgb(var(--${name}-800) / <alpha-value>)`,
    900: `rgb(var(--${name}-900) / <alpha-value>)`,
  };
}

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "Noto Sans JP",
          "Meiryo",
          "sans-serif",
        ],
      },
      colors: {
        ink: themedColor("ink"),
        accent: themedColor("accent"),
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--surface-alt) / <alpha-value>)",
      },
      boxShadow: {
        panel: "0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 8px -2px rgb(0 0 0 / 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
