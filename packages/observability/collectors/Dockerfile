ARG NODE_VERSION=24.17.0
FROM node:${NODE_VERSION}-slim

# The collector is a single file that uses nothing beyond the Node runtime and
# global fetch, so there is no package install step and no lockfile to copy —
# the image is the runtime plus one source file.
WORKDIR /app
COPY packages/observability/collectors/actions-queue.ts .

# Runs in its default looping mode. Repository, sample interval and token come
# from the task environment; see packages/observability/README.md.
ENTRYPOINT ["node", "actions-queue.ts"]
