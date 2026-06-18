# syntax=docker/dockerfile:1

FROM node:24.17.1-slim
ARG worker_script
ENV worker_script=$worker_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip postgresql jq
RUN npm install -g pnpm@11.0.9

# Cache-friendly dependency fetch: this layer only re-runs when the lockfile
# (or patches it references) changes, not on every source edit. `pnpm fetch`
# populates the global pnpm store in $HOME from the lockfile alone, so the
# subsequent `pnpm install --offline` doesn't need the registry.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches
RUN CI=1 pnpm fetch

COPY . ./
RUN CI=1 pnpm install -r --offline

EXPOSE 3000

CMD exec /realm-server/packages/realm-server/$worker_script
