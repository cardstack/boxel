ARG NODE_VERSION=24.17.0
ARG PNPM_VERSION=11.0.9
FROM node:${NODE_VERSION}-slim
ARG CI=1
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y postgresql
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /boxel
# This image never launches a browser, so skip Puppeteer's Chrome download. Its
# extractor needs a native tar/unzip binary that node:slim doesn't ship.
ENV PUPPETEER_SKIP_DOWNLOAD=true

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

# --ignore-pattern keeps node-pg-migrate from treating non-migration files in
# the migrations directory (the `{ "type": "commonjs" }` package.json that
# pins migrations to CommonJS, plus .eslintrc.js) as migrations. Without it,
# package.json is loaded as a migration, has no `up` export, and the whole `up`
# run errors and rolls back — so no migrations apply. Mirrors the `migrate`
# script in package.json. (.eslintrc.js is a dotfile and ignored by default;
# package.json is not, so it must be listed explicitly.)
CMD node ./scripts/fix-migration-names.ts && ./node_modules/.bin/node-pg-migrate --check-order false --migrations-table migrations --ignore-pattern '.*\.eslintrc\.js|package\.json' up && sleep infinity
