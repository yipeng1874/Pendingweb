import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Open tabs may still lazy-load hashed chunks from the previous build.
  // Keep those assets available when rebuilding the directory served by Nginx.
  build: { emptyOutDir: false },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 4173,
    strictPort: true,
    watch: {
      // Wait for editor/script writes to finish before transforming page modules.
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    },
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
});
