# syntax=docker/dockerfile:1

FROM node:18-slim
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip
RUN curl -f https://get.pnpm.io/v6.16.js | env PNPM_VERSION=7 node - add --global pnpm

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN pnpm fetch
RUN pnpm install -r --offline

EXPOSE 3000

CMD pnpm --filter "./packages/realm-server" $realm_server_script
