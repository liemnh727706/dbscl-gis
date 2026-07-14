import { defineConfig } from "vite";

// Dev: proxy API ve server Node (3000)
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
