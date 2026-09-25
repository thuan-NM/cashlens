import { react } from "@repo/eslint-config/react";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig(
    { ignores: ["dist", "coverage", "test-results", "playwright-report"] },
    react({ globals: globals.browser }),
    {
        // API types come from @repo/api-contract, never from the API sources.
        files: ["**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [{ regex: "(^|/)api/src(/|$)|^@prisma/|^@nestjs/", message: "Import API types from @repo/api-contract." }] }],
        },
    },
);
