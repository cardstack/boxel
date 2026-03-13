ARG NODE_VERSION=24.13.1
ARG PNPM_VERSION=10.30.0
FROM node:${NODE_VERSION}-slim
ARG CI=1
ARG PNPM_VERSION
RUN apt-get update && apt-get install -y postgresql
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /boxel
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/postgres

CMD ./node_modules/.bin/ts-node --transpileOnly ./scripts/fix-migration-names.ts && ./node_modules/.bin/node-pg-migrate --check-order false --migrations-table migrations up && sleep infinity
