FROM node:18.6.0-slim
ARG CI=1
RUN apt-get update && apt-get install -y postgresql tree
RUN npm install -g pnpm@8.10.5
WORKDIR /postgres
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /postgres

CMD tree . && ./node_modules/.bin/node-pg-migrate --migrations-table migrations up
