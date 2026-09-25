import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { base } from "./base.js";

/**
 * React + Vite projects: the shared base plus the React Hooks rules and the
 * Fast Refresh export rule, for TypeScript sources. Use inside `defineConfig`
 * (from `eslint/config`). `globals` is the app's environment, for example
 * `globals.browser` from the app's own `globals` dependency.
 *
 * @param {{ globals: Record<string, boolean | "readonly" | "writable" | "off"> }} options
 */
export const react = ({ globals }) => [
  {
    files: ["**/*.{ts,tsx}"],
    extends: base,
    languageOptions: {
      ecmaVersion: 2020,
      globals,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
];
