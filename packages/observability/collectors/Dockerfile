ARG NODE_VERSION=24.22.1
FROM node:${NODE_VERSION}-slim

# The collector uses nothing beyond the Node runtime and global fetch, so there
# is no package install step and no lockfile to copy — the image is the runtime
# plus the collector's source files.
WORKDIR /app
COPY packages/observability/collectors/actions-queue.ts \
     packages/observability/collectors/spill.ts \
     packages/observability/collectors/github-app.ts \
     packages/observability/collectors/github-api.ts \
     ./

# Runs in its default looping mode. Repository, sample interval and token come
# from the task environment; see packages/observability/README.md.
ENTRYPOINT ["node", "actions-queue.ts"]
