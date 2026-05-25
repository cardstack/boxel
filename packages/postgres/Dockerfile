ARG NODE_VERSION=24.13.1
ARG PNPM_VERSION=11.0.9
FROM node:${NODE_VERSION}-slim
ARG CI=1
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y postgresql
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /boxel

# Cache-friendly dependency fetch: this layer only re-runs when the lockfile
# (or patches it references) changes, not on every source edit. `pnpm fetch`
# populates the global pnpm store in $HOME from the lockfile alone, so the
# subsequent `pnpm install --offline` doesn't need the registry.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches
RUN CI=1 pnpm fetch

COPY . .
RUN CI=1 pnpm install -r --offline

WORKDIR /boxel/packages/postgres

CMD ./node_modules/.bin/ts-node --transpileOnly ./scripts/fix-migration-names.ts && ./node_modules/.bin/node-pg-migrate --check-order false --migrations-table migrations up && sleep infinity
