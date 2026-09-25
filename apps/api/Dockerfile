# syntax=docker/dockerfile:1
#
# CashLens API release images (OPS-006). Build context: the repository root.
#   docker build -f apps/api/Dockerfile --target runtime .   # API server
#   docker build -f apps/api/Dockerfile --target tools .     # one-off migrations
#
# No source mount, dependency install, or watcher happens at runtime, and no
# environment file is copied: every setting arrives at `docker run` time.

ARG NODE_IMAGE=node:22-alpine

# --- build: install dependencies, generate the Prisma client, compile -------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Toolchain for native modules (bcrypt) when no prebuilt binary matches.
RUN apk add --no-cache python3 make g++ && corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
RUN yarn workspaces focus api
# Shared compiler settings that apps/api/tsconfig.json extends.
COPY packages/typescript-config packages/typescript-config
COPY apps/api apps/api
# `prisma generate` never connects; this credential-free URL only satisfies prisma.config.ts.
RUN DATABASE_URL="postgresql://localhost:5432/build" yarn workspace api prisma generate \
  && yarn workspace api build

# --- tools: one-off `prisma migrate deploy` inside the compose network --------
# Runtime images carry no Prisma CLI, so migrations run from this stage.
FROM build AS tools
WORKDIR /app/apps/api
ENV NODE_ENV=production
USER node
CMD ["/app/node_modules/.bin/prisma", "migrate", "deploy"]

# --- prod-deps: production dependencies only --------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ && corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
RUN yarn workspaces focus api --production \
  && mkdir -p apps/api/node_modules

# --- runtime: compiled API + production dependencies -------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
# Generated Prisma client (output of `prisma generate` in the build stage).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# dist/src/ includes main.js and the operator scripts under dist/src/scripts/.
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3000
# Exec form keeps node as the signal target so SIGTERM runs Nest shutdown hooks.
CMD ["node", "dist/src/main.js"]
