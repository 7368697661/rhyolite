/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Satoshi",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        /** Alias for prose / editor (same as sans; keeps existing class names) */
        body: [
          "Satoshi",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        heading: [
          '"Nightingale"',
          "var(--font-cormorant)",
          "ui-serif",
          "Georgia",
          "serif",
        ],
        /** Use with font-style: italic (see globals.css em, i) */
        fraunces: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
      },
      boxShadow: {
        "uv-glow":
          "0 0 24px rgba(139, 92, 246, 0.12), 0 0 2px rgba(167, 139, 250, 0.35)",
      },
    },
  },
  plugins: []
};

