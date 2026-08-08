import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// envDir points to the repo root so the frontend reads the single-source .env.
export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, ".."),
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // Tauri expects a fixed dev-server URL (see src-tauri/tauri.conf.json → devUrl).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
});
