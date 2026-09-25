# `@repo/eslint-config`

Shared ESLint flat-config building blocks for CashLens:

| Export | Used by | Contents |
|---|---|---|
| `@repo/eslint-config/base` | `react` | ESLint recommended + typescript-eslint recommended |
| `@repo/eslint-config/node` | `apps/api` | ESLint recommended, type-aware typescript-eslint, Prettier |
| `@repo/eslint-config/react` | `apps/web` | `base` + React Hooks + React Refresh |

Environment globals, ignores, and app-specific rule choices stay in each app's `eslint.config`.
