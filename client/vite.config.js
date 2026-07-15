import { defineConfig } from "vite";

// Dev: proxy API ve server Node (3000)
export default defineConfig({
  // main.js dung top-level await (tai style ban do truoc khi khoi tao)
  build: { target: "es2022" },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
