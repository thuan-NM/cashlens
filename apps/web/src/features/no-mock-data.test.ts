import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runtimeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return full === path.join(srcDir, "test") ? [] : runtimeFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });

// Static imports, re-exports, dynamic imports, and requires of config/mockData, by alias or relative path.
const MOCK_DATA_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"']*config\/mockData(?:\.tsx?)?["']/;

describe("no runtime mock-data fallback (T097)", () => {
  it("scans the runtime sources", () => {
    const files = runtimeFiles(srcDir);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.endsWith(path.join("providers", "dataProvider.ts")))).toBe(true);
  });

  it("the demo mock-data module is gone", () => {
    expect(existsSync(path.join(srcDir, "config", "mockData.ts"))).toBe(false);
  });

  it("no runtime module imports config/mockData", () => {
    const offenders = runtimeFiles(srcDir)
      .filter((file) => MOCK_DATA_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it("no runtime module carries demo credentials or a hardcoded identity", () => {
    // Formerly: a sign-in fallback that submitted a fixed email/password when
    // the form was empty, and a fixed name in the sidebar.
    const DEMO = /demo1234|thuan\.nguyen@|Minh Thuận|Dùng thử bản demo/;
    const offenders = runtimeFiles(srcDir)
      .filter((file) => DEMO.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it("the pattern recognises the import forms it guards against", () => {
    for (const line of [
      'import { transactions } from "@/config/mockData";',
      "export * from '../config/mockData';",
      'const data = await import("@/config/mockData");',
    ]) {
      expect(MOCK_DATA_IMPORT.test(line)).toBe(true);
    }
  });
});
