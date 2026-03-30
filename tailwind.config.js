/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      animation: {
        'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 150ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      fontFamily: {
        sans: [
          "Satoshi",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        /** Alias for prose / editor */
        body: [
          '"Monaspace Neon"',
          "monospace",
        ],
        mono: [
          '"Monaspace Neon"',
          "monospace",
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

