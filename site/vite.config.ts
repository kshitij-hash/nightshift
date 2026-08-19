import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps every asset reference relative, so the same build works on
// GitHub Pages under /nightshift/ and on any local static server.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
