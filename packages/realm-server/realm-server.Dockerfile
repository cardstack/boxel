# syntax=docker/dockerfile:1

FROM node:24.22.1-slim AS base

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip postgresql jq rsync git
RUN npm install -g pnpm@12.7.0

# Cache-friendly dependency fetch: this layer only re-runs when the lockfile,
# the patches it references, or the pnpmfile changes, not on every source edit.
# `pnpm fetch` populates the global pnpm store in $HOME, so the subsequent
# `pnpm install --offline` doesn't need the registry. The pnpmfile belongs here
# because the lockfile records its checksum: a frozen fetch that cannot
# recompute it fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches/ ./patches
RUN CI=1 pnpm fetch

# boxel-icons' build, in a stage of its own, so its layers are cached until
# boxel-icons or what the dependency fetch above reads changes, rather than
# rebuilt with every source edit. Packages compiled from source into the
# secure origin's build import icons from its `dist/`. The stage copies
# boxel-icons and only the manifests of the workspace packages it depends on,
# which its install links but its JS build never reads, and builds only its
# JS: the type declarations are for type-checking, which the image never does.
FROM base AS boxel-icons
COPY package.json ./
COPY packages/boxel-icons ./packages/boxel-icons
COPY packages/eslint-plugin-boxel/package.json ./packages/eslint-plugin-boxel/
COPY packages/local-types/package.json ./packages/local-types/
RUN CI=1 pnpm install --offline --filter @cardstack/boxel-icons...
RUN pnpm --dir=packages/boxel-icons build:js

FROM base
ARG realm_server_script
ENV realm_server_script=$realm_server_script

COPY . ./
RUN CI=1 pnpm install -r --offline
COPY --from=boxel-icons /realm-server/packages/boxel-icons/dist ./packages/boxel-icons/dist

# The Choreo gallery realm's films run from a built app that isn't committed.
# Building it into the realm here means setup:choreo-gallery-in-deployment
# copies the films along with the rest of the realm.
RUN pnpm --dir=packages/choreo-film-app build:realm

# The secure origin's pages, which the realm server serves from their build.
# A build that fails, or ships a module outside its import allowlist, fails
# the image here rather than the realm server at startup. The build records
# the files it was made from, so the start scripts serve this build as it is
# rather than building again (`build:secure-origin:if-stale`).
RUN pnpm --dir=packages/secure-origin build

EXPOSE 3000

CMD exec /realm-server/packages/realm-server/$realm_server_script
