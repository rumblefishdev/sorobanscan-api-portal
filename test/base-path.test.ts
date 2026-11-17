// @vitest-environment node
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { basePath, routerBasename } from "../src/base-path";

const root = fileURLToPath(new URL("..", import.meta.url));

const built = async (base: string) => {
  const result = await build({ root, base, logLevel: "silent", build: { write: false } });
  return (Array.isArray(result) ? result : [result]).flatMap((part) =>
    "output" in part ? part.output : [],
  );
};
type OutputFile = Awaited<ReturnType<typeof built>>[number];
const text = (file: OutputFile) => (file.type === "asset" ? String(file.source) : file.code);

describe("basePath", () => {
  it("is /api/ when the setting is absent or empty", () => {
    expect(basePath(undefined)).toBe("/api/");
    expect(basePath("")).toBe("/api/");
  });
  it("takes a prefix with both slashes", () => {
    expect(basePath("/api/next/")).toBe("/api/next/");
  });
  it.each(["api/next/", "/api/next", "api"])("refuses %s, naming the setting", (value) => {
    expect(() => basePath(value)).toThrow(/VITE_BASE_PATH/);
  });
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
    const index = output.find((file) => file.fileName === "index.html");
    if (!index) throw new Error("the build has no index.html");
    page = text(index);
  });

  it("asks for every file under the prefix", () => {
    const urls = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(new RegExp(`^${base}assets/`));
  });

  it("ships its fonts and names no other host", () => {
    expect(output.some((file) => file.fileName.endsWith(".woff2"))).toBe(true);
    for (const file of output.filter((file) => /\.(html|css)$/.test(file.fileName))) {
      expect(text(file)).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
      expect(text(file)).not.toContain("fonts.googleapis.com");
    }
    expect(page).not.toMatch(/<script\b[^>]*\bsrc="(?:http|\/\/)/);
    expect(page).not.toMatch(/<link\b[^>]*\bhref="(?:http|\/\/)/);
  });

  it("is noindex only away from /api/", () => {
    expect(page.includes('<meta name="robots" content="noindex"')).toBe(base !== "/api/");
  });
});
