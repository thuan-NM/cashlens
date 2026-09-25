import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The web app takes API types only from @repo/api-contract. The lint rule that
 * enforces it must catch relative paths into the API sources, not only bare
 * package names.
 */
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const restricted = async (specifier: string) => {
  const eslint = new ESLint({ cwd: webRoot });
  const [result] = await eslint.lintText(`import type { X } from "${specifier}";\nexport type Y = X;\n`, {
    filePath: path.join(webRoot, "src", "features", "goals", "boundary-probe.ts"),
  });
  return result.messages.some((message) => message.ruleId === "no-restricted-imports");
};

describe("API import boundary", () => {
  it.each([
    "../../../../api/src/modules/goals/dto/goal.response",
    "../../../../../apps/api/src/modules/goals/goals.mapper",
    "@prisma/client",
    "@nestjs/common",
  ])("rejects %s", async (specifier) => {
    expect(await restricted(specifier)).toBe(true);
  });

  it("allows the generated contract package", async () => {
    expect(await restricted("@repo/api-contract")).toBe(false);
  });
});
