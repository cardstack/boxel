FROM node:18.6.0-slim
ARG CI=1
RUN apt-get update && apt-get install -y postgresql
RUN npm install -g pnpm@8.10.5
WORKDIR /boxel
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/postgres

# after the migration is done the container is available for manual DB introspection
CMD ./node_modules/.bin/node-pg-migrate --check-order false --migrations-table migrations up && sleep infinity
