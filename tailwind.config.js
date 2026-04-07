/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./src/**/*.{html,js,svelte,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Assistant", "sans-serif"],
        mono: ["Monaspace Neon", "monospace"],
        heading: ["Nightingale", "sans-serif"],
        serif: ["Cormorant Garamond", "serif"],
        italics: ["Fraunces", "serif"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      boxShadow: {
        "uv-glow": "0 0 10px rgba(139, 92, 246, 0.4)",
        "uv-glow-strong": "0 0 15px rgba(139, 92, 246, 0.6)",
      },
      animation: {
        scanline: "scanline 8s linear infinite",
        flicker: "flicker 0.15s infinite",
        crt: "crt 4s infinite",
        blink: "blink 1s step-end infinite",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        flicker: {
          "0%": { opacity: "0.95" },
          "100%": { opacity: "1" },
        },
        crt: {
          "0%": { opacity: "0.9", textShadow: "0 0 5px rgba(139, 92, 246, 0.3)" },
          "50%": { opacity: "1", textShadow: "0 0 8px rgba(139, 92, 246, 0.6)" },
          "100%": { opacity: "0.9", textShadow: "0 0 5px rgba(139, 92, 246, 0.3)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
