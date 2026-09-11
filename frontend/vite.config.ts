import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : process.env.VITE_BASE_PATH || "/ugyfelszolg/",
  plugins: [react(), {
    name: "spa-fallback-base",
    closeBundle() {
      const base = process.env.VITE_BASE_PATH || "/ugyfelszolg/";
      const fallback = readFileSync("public/404.html", "utf8").replaceAll('"/spa-redirect.js"', `"${base}spa-redirect.js"`).replace('href="/"', `href="${base}"`);
      writeFileSync("dist/404.html", fallback);
    },
  }],
}));
