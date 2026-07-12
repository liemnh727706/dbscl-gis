import { defineConfig } from "vite";

// Dev: proxy API ve server Node (3000) va tile ve TiTiler (8000)
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/tiles": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tiles/, ""),
      },
    },
  },
});
