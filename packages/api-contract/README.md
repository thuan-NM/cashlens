# `@repo/api-contract`

TypeScript types for the CashLens HTTP API, generated from the API's OpenAPI document. Types only.

```text
Nest API (controllers + response DTOs, each mapper returns its DTO)
  → yarn workspace api swagger:generate        → apps/api/docs/swagger.json
  → yarn workspace @repo/api-contract generate → src/generated/openapi.ts (committed)
  → src/index.ts aliases                       → apps/web (import type … from "@repo/api-contract")
```

**Generated output is committed.** It is deterministic (LF, alphabetized, no timestamps), so reviewers see contract changes in the diff and nothing is generated at install time.

**Staleness guards**
- `yarn workspace @repo/api-contract check-types` (also run by the root `yarn check-types`) fails when `src/generated/openapi.ts` differs from what `swagger.json` produces.
- `apps/api/src/swagger.spec.ts` fails when a contract response schema disappears from the committed `swagger.json`.
- `yarn workspace api swagger:check` fails when `swagger.json` differs from what the code generates. The root `yarn contract:check` runs both checks.
- The web and this package reject imports of API sources, Prisma, or NestJS (ESLint `no-restricted-imports`, pinned by `apps/web/src/test/import-boundary.test.ts`).

**Rules**
- Never import NestJS, Prisma, or `apps/api` sources here (enforced by ESLint).
- Add an alias to `src/index.ts` only for a schema backed by a response DTO that its API mapper declares as its return type, so the documented shape cannot drift from the runtime shape.
