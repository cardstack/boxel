# syntax=docker/dockerfile:1

FROM node:18.6.0-slim
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip
RUN npm install -g pnpm@8

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN pnpm fetch
RUN pnpm install -r --offline

EXPOSE 3000

CMD pnpm --filter "./packages/realm-server" $realm_server_script
