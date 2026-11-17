// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../vite.config.ts";

type TestProject = {
  extends?: boolean | string;
  test?: { name?: string; include?: string[]; environment?: string; setupFiles?: string[] };
};
type TestOptions = TestProject["test"] & {
  env?: Record<string, string>;
  projects?: TestProject[];
};

/** The config as Vitest reads it, with `VITE_BASE_PATH` from the environment, not `.env` files. */
const resolve = (basePath: string) => {
  vi.stubEnv("VITE_BASE_PATH", basePath);
  const config =
    typeof viteConfig === "function" ? viteConfig({ command: "serve", mode: "test" }) : viteConfig;
  expect(config).not.toBeInstanceOf(Promise);
  return config as { base?: string; test?: TestOptions };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the tests' config", () => {
  // The tests are written for the default prefix, which the boot module and the Prices paths are
  // derived from: a `VITE_BASE_PATH` in a local `.env` file must not change what they see.
  it("gives the tests the default prefix, whatever VITE_BASE_PATH says", () => {
    const config = resolve("/api/next/");
    expect(config.base).toBe("/api/next/");
    expect(config.test?.env?.BASE_URL).toBe("/api/");
  });

  // The hub's backend runs on Node: a file in `bff/test` gets Node by where it is, not by a
  // docblock it might lack, and none of the page's DOM setup.
  it("runs bff/test in Node without the page's setup, and the rest as before", () => {
    const test = resolve("").test;
    expect(test?.setupFiles).toBeUndefined();
    expect(test?.environment).toBeUndefined();
    const project = (name: string) => test?.projects?.find((p) => p.test?.name === name);

    expect(project("bff")).toEqual({
      extends: true,
      test: { name: "bff", include: ["bff/test/**/*.test.ts"], environment: "node" },
    });
    expect(project("page")).toEqual({
      extends: true,
      test: {
        name: "page",
        include: ["test/**/*.test.{ts,tsx}", "src/prices/**/*.spec.{ts,tsx}"],
        environment: "jsdom",
        setupFiles: ["test/setup.ts"],
      },
    });
    expect(test?.projects).toHaveLength(2);
  });
});
