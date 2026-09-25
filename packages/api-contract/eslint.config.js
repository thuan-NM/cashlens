import { base } from "@repo/eslint-config/base";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["src/generated/**", "scripts/**"] },
  { files: ["**/*.ts"], extends: base },
  {
    // The contract describes the HTTP API only: it must never reach into the
    // API implementation, its framework, or its database types.
    files: ["**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)api/src(/|$)|(^|/)apps/api(/|$)|^@prisma/|^@nestjs/", message: "The API contract is generated from OpenAPI; do not import API internals." },
          ],
        },
      ],
    },
  },
);
