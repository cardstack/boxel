# syntax=docker/dockerfile:1

FROM node:18
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN pnpm fetch
RUN pnpm install -r --offline

EXPOSE 3000

CMD pnpm --filter "./packages/realm-server" $realm_server_script
