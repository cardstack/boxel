ARG NODE_VERSION=24.13.1
ARG PNPM_VERSION=10.30.0
FROM node:${NODE_VERSION}-slim
ARG CI=1
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y python3 build-essential
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /boxel
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/bot-runner
ENTRYPOINT ["pnpm", "start"]
