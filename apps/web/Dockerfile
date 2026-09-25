# syntax=docker/dockerfile:1
#
# CashLens web release image (OPS-006). Build context: the repository root.
#   docker build -f apps/web/Dockerfile .
#
# Same-origin production routing (OPS-009): the operator's proxy sends /api/ to
# the API and / to this image, so the bundle is always built with the relative
# VITE_API_BASE_URL=/api and never embeds an absolute API origin.

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
RUN yarn workspaces focus web
# Shared compiler settings, and the generated API contract types the web
# type-check imports (types only: nothing from them reaches the bundle).
COPY packages/typescript-config packages/typescript-config
COPY packages/api-contract packages/api-contract
COPY apps/web apps/web
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN yarn workspace web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
