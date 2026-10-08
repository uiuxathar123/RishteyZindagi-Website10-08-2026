import type { Config } from "tailwindcss";

/**
 * RishteyZindagi Design Tokens
 * ---------------------------------------------------------------
 * Single source of truth for color, type, spacing, radius, shadow,
 * breakpoint and z-index values. Components must consume these
 * tokens (via Tailwind classes) rather than hard-coded values.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    screens: {
      sm: "480px", // large phones
      md: "768px", // tablet
      lg: "1024px", // small desktop
      xl: "1200px", // desktop
      "2xl": "1440px", // wide desktop
    },
    extend: {
      colors: {
        rz: {
          navy: "#102C46",
          "navy-dark": "#0B1F32",
          maroon: "#A51E3B",
          "maroon-dark": "#7A1730",
          red: "#B51F40",
          gold: "#C99A45",
          "gold-soft": "#E1BE83",
          "gold-rich": "#B8863A",
          "gold-deep": "#7A5A18",
          champagne: "#F4E5C4",
          cream: "#FFF9EF",
          ivory: "#FFFDF8",
          peach: "#F9E9DF",
          border: "#DDE2E8",
          text: "#172B3A",
          muted: "#667085",
          success: "#1D8A5E",
          warning: "#B8791A",
          danger: "#C42A3B",
          info: "#2C6FB0",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        serif: ["var(--font-serif)", "Georgia", "Times New Roman", "serif"],
      },
      spacing: {
        // Matches the brief's spacing scale 1:1 with Tailwind's default
        // rem-based scale (4=1, 8=2, 12=3, 16=4, 20=5, 24=6, 32=8,
        // 40=10, 48=12, 64=16, 80=20) — documented here for reference,
        // no overrides needed.
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "10px",
        md: "12px",
        lg: "16px",
        xl: "20px",
      },
      boxShadow: {
        card: "0 18px 50px rgba(20, 35, 50, 0.16)",
        "card-sm": "0 8px 24px rgba(20, 35, 50, 0.10)",
        popover: "0 12px 32px rgba(16, 44, 70, 0.18)",
        "focus-ring": "0 0 0 3px rgba(165, 30, 59, 0.16)",
      },
      zIndex: {
        base: "0",
        decor: "1",
        content: "10",
        sticky: "40",
        header: "100",
        overlay: "150",
        modal: "200",
        toast: "300",
        tooltip: "350",
      },
      transitionTimingFunction: {
        rz: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      maxWidth: {
        container: "1440px",
      },
    },
  },
  plugins: [],
};

export default config;
