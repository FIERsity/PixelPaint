import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  // 相对路径，兼容 GitHub Pages 子路径部署 (FIERsity.github.io/PixelPaint/)
  base: "./",
  plugins: [react(), tailwindcss()],
});
