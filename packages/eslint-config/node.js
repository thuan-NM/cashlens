import js from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

/**
 * NestJS/Node projects: type-aware typescript-eslint rules and Prettier as a
 * lint rule. `tsconfigRootDir` is the consuming project's directory (type
 * information resolves relative to it); `globals` is its environment, for
 * example `{ ...globals.node, ...globals.jest }` from its own `globals`.
 *
 * @param {{ tsconfigRootDir: string, globals: Record<string, boolean | "readonly" | "writable" | "off"> }} options
 */
export const node = ({ tsconfigRootDir, globals }) => [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals,
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
  },
];
