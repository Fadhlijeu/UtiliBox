import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    assetsDir: "assets"
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
});