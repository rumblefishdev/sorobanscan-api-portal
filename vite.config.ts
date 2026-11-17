import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { basePath, DEFAULT_BASE_PATH } from "./src/base-path.ts";

/**
 * Only the hub at `/api/` should be found by search engines: a build for any other prefix gets
 * `noindex`. It reads the resolved `base`, so a `base` handed to Vite directly counts too.
 */
const noindexOutsideApi = (): Plugin => {
  let base: string;
  return {
    name: "noindex-outside-api",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: () =>
      base === DEFAULT_BASE_PATH
        ? []
        : [{ tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head" }],
  };
};

export default defineConfig({
  base: basePath(process.env.VITE_BASE_PATH),
  plugins: [react(), noindexOutsideApi()],
  test: { include: ["test/**/*.test.{ts,tsx}"], environment: "jsdom" },
});
