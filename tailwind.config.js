/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      animation: {
        'scanline': 'scanline 8s linear infinite',
        'glitch': 'glitch 3s infinite',
        'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s step-end infinite',
        'cpu': 'cpu 1s ease-in-out infinite alternate',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' }
        },
        glitch: {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 1px)' },
          '40%': { transform: 'translate(-1px, -1px)' },
          '60%': { transform: 'translate(2px, 1px)' },
          '80%': { transform: 'translate(1px, -1px)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        cpu: {
          '0%': { height: '10%' },
          '20%': { height: '80%' },
          '40%': { height: '30%' },
          '60%': { height: '90%' },
          '80%': { height: '40%' },
          '100%': { height: '60%' },
        }
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

