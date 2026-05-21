import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          900: "#10233f",
          800: "#17325a",
          700: "#21467c",
        },
        azure: {
          600: "#1769db",
          500: "#2b7fff",
          100: "#eaf2ff",
        },
        mint: {
          600: "#11845b",
          500: "#1aa874",
          100: "#e5f8f0",
        },
      },
      boxShadow: {
        soft: "0 18px 50px rgba(16, 35, 63, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
