# syntax=docker/dockerfile:1

FROM node:24.17.0-slim
ARG realm_server_script
ENV realm_server_script=$realm_server_script

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

COPY . ./
RUN CI=1 pnpm install -r --offline

# The Choreo gallery realm's films run from a built app that isn't committed.
# Building it into the realm here means setup:choreo-gallery-in-deployment
# copies the films along with the rest of the realm.
RUN pnpm --dir=packages/choreo-film-app build:realm

EXPOSE 3000

CMD exec /realm-server/packages/realm-server/$realm_server_script
