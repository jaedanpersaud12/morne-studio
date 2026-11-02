import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import cfg from "./studio.config.json";
import { writeFileSync, mkdirSync } from "node:fs";

const BUILD_ID = String(Date.now());

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: "build-id", closeBundle() { mkdirSync("dist", { recursive: true }); writeFileSync("dist/build-id.txt", BUILD_ID); } }],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${cfg.port}` },
  },
  build: { outDir: "dist" },
});
