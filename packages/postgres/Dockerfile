FROM node:20.19.1-slim
ARG CI=1
RUN apt-get update && apt-get install -y postgresql
RUN npm install -g pnpm@10.9.0
WORKDIR /boxel
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/postgres

CMD ./node_modules/.bin/node-pg-migrate --check-order false --migrations-table migrations up && sleep infinity
