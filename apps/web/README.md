# CashLens web (`apps/web`)

This is the React 19 + refine + antd web app of CashLens, built with Vite. Setup and running are documented at the repository level:

- [Repository overview](../../README.md)
- [Local development](../../docs/operations/local-development.md)

Frequently used commands, run from the repository root:

| Command | Purpose |
|---|---|
| `yarn workspace web test` | Component tests (Vitest, `src/**/*.test.tsx`) |
| `yarn workspace web lint` | ESLint |
| `yarn workspace web build` | Type-check and build to `dist/` |
| `yarn workspace web test:e2e:install` | Install the Playwright Chromium browser (once) |
| `yarn workspace web test:e2e` | Playwright browser tests (`e2e/`) against the running development stack |

The API base URL comes from `VITE_API_BASE_URL`, which defaults to `http://localhost:3000/api` in development. The release image is always built with the relative `/api`.
