import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Rules every CashLens TypeScript project shares: ESLint's recommended set
 * plus typescript-eslint's recommended set. Environment globals, ignores,
 * and project-specific rule choices stay in each app's eslint.config.
 */
export const base = [js.configs.recommended, ...tseslint.configs.recommended];
