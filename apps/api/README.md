# CashLens API (`apps/api`)

This is the NestJS 11 + Prisma 7 API of CashLens. Setup, running, and operations are documented at the repository level:

- [Repository overview](../../README.md)
- [Local development](../../docs/operations/local-development.md): environment, Docker stack, migrations, the admin bootstrap, and tests
- [Deployment](../../docs/operations/deployment.md) and [Troubleshooting](../../docs/operations/troubleshooting.md)

Frequently used commands, run from the repository root:

| Command | Purpose |
|---|---|
| `yarn workspace api prisma generate` | Generate the Prisma client, once after `yarn install` and after schema changes |
| `yarn workspace api test` | Unit tests (`src/**/*.spec.ts`) |
| `yarn workspace api test:e2e` | Integration tests (`test/*.e2e-spec.ts`); needs `E2E_DATABASE_URL` |
| `yarn workspace api lint` / `lint:fix` | ESLint check only / with automatic fixes |
| `yarn workspace api check-types` | Type-check sources and tests |
| `yarn workspace api build` | Compile to `dist/` (the entry point is `dist/src/main.js`) |
| `yarn workspace api start:prod` | Run the compiled API (`node dist/src/main.js`) with the configuration in the environment |
| `yarn workspace api prisma migrate deploy` | Apply migrations to `DATABASE_URL` |
| `yarn workspace api admin:bootstrap --email <email>` | Promote the first administrator (see Local development) |
| `yarn workspace api swagger:generate` | Regenerate `docs/swagger.json` |
