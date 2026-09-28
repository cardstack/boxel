ARG NODE_VERSION=24.17.0
ARG PNPM_VERSION=12.7.0
FROM node:${NODE_VERSION}-slim
ARG CI=1
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y postgresql
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /boxel
# This image never launches a browser, so skip Puppeteer's Chrome download. Its
# extractor needs a native tar/unzip binary that node:slim doesn't ship.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Cache-friendly dependency fetch: this layer only re-runs when the lockfile,
# the patches it references, or the pnpmfile changes, not on every source edit.
# `pnpm fetch` populates the global pnpm store in $HOME, so the subsequent
# `pnpm install --offline` doesn't need the registry. The pnpmfile belongs here
# because the lockfile records its checksum: a frozen fetch that cannot
# recompute it fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches/ ./patches
RUN CI=1 pnpm fetch

COPY . .
RUN CI=1 pnpm install -r --offline

WORKDIR /boxel/packages/postgres

# Run the migrations (see scripts/run-migrations.sh), then keep the container
# alive so the long-lived ECS service stays up after a successful migrate. The
# deploy runs the same script as a one-shot task and gates on its exit code;
# `&& sleep infinity` runs only when the migrate exited 0.
CMD ./scripts/run-migrations.sh && sleep infinity
