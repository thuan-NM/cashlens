// Generates src/generated/openapi.ts from the API's OpenAPI document.
//
//   node scripts/generate.mjs           write the file
//   node scripts/generate.mjs --check   fail (exit 1) when the committed file is stale
//
// Source of truth: the Nest API. `yarn workspace api swagger:generate` writes
// apps/api/docs/swagger.json from the controllers and DTO metadata; this script
// turns that document into TypeScript types. The output is committed and
// deterministic: LF line endings, no timestamps, compared with CRLF normalized.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const source = join(packageRoot, "..", "..", "apps", "api", "docs", "swagger.json");
const target = join(packageRoot, "src", "generated", "openapi.ts");

const HEADER = `/**
 * GENERATED FILE. Do not edit by hand.
 * Source: apps/api/docs/swagger.json (yarn workspace api swagger:generate).
 * Regenerate: yarn workspace @repo/api-contract generate
 */

`;

const schema = JSON.parse(await readFile(source, "utf8"));
const ast = await openapiTS(schema, { alphabetize: true });
const generated = (HEADER + astToString(ast)).replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = (await readFile(target, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    // Missing counts as stale.
  }
  if (committed !== generated) {
    console.error(
      `${relative(process.cwd(), target)} is stale relative to apps/api/docs/swagger.json. ` +
        "Run: yarn workspace @repo/api-contract generate",
    );
    process.exit(1);
  }
  console.log("API contract types are current.");
} else {
  await writeFile(target, generated, "utf8");
  console.log(`Wrote ${relative(process.cwd(), target)}`);
}
