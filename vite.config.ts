import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
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

// `VITE_BASE_PATH` is read as Vite reads its other settings: from the `.env` files of the mode
// built, and from `process.env`, which wins over them.
export default defineConfig(({ mode }) => ({
  base: basePath(loadEnv(mode, process.cwd(), "VITE_BASE_PATH").VITE_BASE_PATH),
  plugins: [react(), noindexOutsideApi()],
  test: {
    include: ["test/**/*.test.{ts,tsx}", "src/prices/**/*.spec.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
}));
