import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev server proxies /api to the Express process, so the browser only ever
 * talks to one origin and there is no CORS or token-storage difference between
 * development and the production build served by Express itself.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // React rarely changes between deploys; splitting it keeps the app
        // chunk small so a code change does not invalidate the vendor cache.
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
