# syntax=docker/dockerfile:1

FROM node:24.13.1-slim
ARG prerender_manager_script
ENV prerender_manager_script=$prerender_manager_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip jq
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

EXPOSE 4222

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent --show-error --max-time 5 --output /dev/null http://localhost:4222/ || exit 1

CMD exec pnpm --filter "./packages/realm-server" $prerender_manager_script
