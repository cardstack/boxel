# syntax=docker/dockerfile:1

FROM node:24.17.0-slim
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip postgresql jq rsync git
RUN npm install -g pnpm@11.0.9

# jj binary for the realm-history sidecar (BPM Phase 0R). The sidecar is
# inert unless ENABLE_REALM_HISTORY=true, but the binary ships so opting in
# is a config change, not a rebuild. Static musl build, arch-mapped.
ARG JJ_VERSION=0.43.0
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) jj_arch='x86_64-unknown-linux-musl' ;; \
         arm64) jj_arch='aarch64-unknown-linux-musl' ;; \
         *) echo "unsupported arch for jj: $arch" && exit 1 ;; \
       esac \
    && curl -fsSL "https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-${jj_arch}.tar.gz" \
       | tar -xz -C /usr/local/bin ./jj \
    && jj --version

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

CMD exec /realm-server/packages/realm-server/$realm_server_script
