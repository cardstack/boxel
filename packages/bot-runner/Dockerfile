ARG NODE_VERSION=24.17.0
ARG PNPM_VERSION=11.0.9
FROM node:${NODE_VERSION}-slim
ARG CI=1
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y python3 build-essential
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /boxel
# This image never launches a browser, so skip Puppeteer's Chrome download. Its
# extractor needs a native tar/unzip binary that node:slim doesn't ship.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/bot-runner
ENTRYPOINT ["pnpm", "start"]
