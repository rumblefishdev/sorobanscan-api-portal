// @vitest-environment node
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { basePath, routerBasename } from "../src/base-path";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Builds the page; without `base`, Vite takes the one `vite.config.ts` gives. `mode` picks the
 * `.env.[mode]` file the config reads, as `vite build --mode` does; Vite's own is `production`.
 */
const built = async (base?: string, mode?: string) => {
  const result = await build({ root, base, mode, logLevel: "silent", build: { write: false } });
  return (Array.isArray(result) ? result : [result]).flatMap((part) =>
    "output" in part ? part.output : [],
  );
};
type OutputFile = Awaited<ReturnType<typeof built>>[number];
const text = (file: OutputFile) => (file.type === "asset" ? String(file.source) : file.code);
const indexHtml = (output: OutputFile[]) => {
  const index = output.find((file) => file.fileName === "index.html");
  if (!index) throw new Error("the build has no index.html");
  return text(index);
};
/**
 * The page's analytics, as on the rest of sorobanscan.com: GTM's container and HubSpot's banner
 * (`index.html`). These two are the only files it asks another host for, and these two hosts the
 * only others it names.
 */
const ANALYTICS_URLS = [
  "https://www.googletagmanager.com/ns.html?id=GTM-TBF2GP5S",
  "//js.hs-scripts.com/8102665.js",
];
const ANALYTICS_HOSTS = ["js.hs-scripts.com", "www.googletagmanager.com"];
const expectEveryFileUnder = (page: string, base: string) => {
  const urls = [...page.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1] ?? "")
    .filter((url) => !ANALYTICS_URLS.includes(url));
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) expect(url).toMatch(new RegExp(`^${base}assets/`));
};
/** Every host a URL in `content` names, `//host/…` with a scheme before it or without, sorted. */
const hostsNamed = (content: string) =>
  [...new Set([...content.matchAll(/\/\/([\w-]+(?:\.[\w-]+)+)/g)].map((m) => m[1]))].sort();
const isNoindex = (page: string) => page.includes('<meta name="robots" content="noindex"');

describe("basePath", () => {
  it("is /api/ when the setting is absent or empty", () => {
    expect(basePath(undefined)).toBe("/api/");
    expect(basePath("")).toBe("/api/");
  });
  it("takes a prefix with both slashes", () => {
    expect(basePath("/api/next/")).toBe("/api/next/");
  });
  // `//api/next/` (and `/\api/next/`, which a browser reads the same) would make the page ask
  // another host, `api`, for its files.
  it.each(["api/next/", "/api/next", "api", "//api/next/", "/\\api/next/"])(
    "refuses %s, naming the setting",
    (value) => {
      expect(() => basePath(value)).toThrow(/VITE_BASE_PATH/);
    },
  );
  it("gives the router the prefix without its last slash", () => {
    expect(routerBasename("/api/")).toBe("/api");
    expect(routerBasename("/api/next/")).toBe("/api/next");
  });
});

describe.each(["/api/", "/api/next/"])("the page built for %s", (base) => {
  let output: OutputFile[];
  let page: string;
  beforeAll(async () => {
    output = await built(base);
    page = indexHtml(output);
  });

  it("asks for every file under the prefix", () => {
    expectEveryFileUnder(page, base);
  });

  it("ships its fonts and names no other host but the analytics'", () => {
    expect(output.some((file) => file.fileName.endsWith(".woff2"))).toBe(true);
    for (const file of output.filter((file) => /\.(html|css)$/.test(file.fileName))) {
      expect(text(file)).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
      expect(text(file)).not.toContain("fonts.googleapis.com");
      for (const host of hostsNamed(text(file))) expect(ANALYTICS_HOSTS).toContain(host);
    }
    expect(hostsNamed(page)).toEqual(ANALYTICS_HOSTS);
  });

  it("denies consent by default before it loads GTM's container", () => {
    const defaultAt = page.search(/analytics_storage:\s*'denied'/);
    expect(defaultAt).toBeGreaterThanOrEqual(0);
    expect(defaultAt).toBeLessThan(page.indexOf("googletagmanager.com/gtm.js"));
    expect(page).toContain("GTM-TBF2GP5S");
  });

  it("is noindex only away from /api/", () => {
    expect(isNoindex(page)).toBe(base !== "/api/");
  });
});

// The builds above hand Vite their `base`, which overrides the config's. These go through
// `vite.config.ts` as `pnpm build` does, the setting reaching it in `process.env`.
describe.each([
  ["", "/api/"],
  ["/api/next/", "/api/next/"],
])("the page built through the config with VITE_BASE_PATH=%j", (setting, base) => {
  let page: string;
  beforeAll(async () => {
    vi.stubEnv("VITE_BASE_PATH", setting);
    try {
      page = indexHtml(await built());
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it(`asks for every file under ${base}`, () => {
    expectEveryFileUnder(page, base);
  });

  it("is noindex only away from /api/", () => {
    expect(isNoindex(page)).toBe(base !== "/api/");
  });
});

// `vite build` reads `.env` files, and a setting given in one counts as it does in `process.env`.
describe("the page built through the config with VITE_BASE_PATH in a .env file", () => {
  const mode = "base-path-test";
  let page: string;
  beforeAll(async () => {
    const envFile = join(root, `.env.${mode}`);
    writeFileSync(envFile, "VITE_BASE_PATH=/api/from-env-file/\n");
    vi.stubEnv("VITE_BASE_PATH", undefined);
    try {
      page = indexHtml(await built(undefined, mode));
    } finally {
      vi.unstubAllEnvs();
      rmSync(envFile);
    }
  });

  it("asks for every file under the prefix the file gives", () => {
    expectEveryFileUnder(page, "/api/from-env-file/");
  });

  it("is noindex", () => {
    expect(isNoindex(page)).toBe(true);
  });
});
