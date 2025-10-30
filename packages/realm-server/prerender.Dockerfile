# syntax=docker/dockerfile:1

FROM node:22.20.0-slim
ARG prerender_script
ENV prerender_script=$prerender_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip jq
RUN npm install -g pnpm@10.17.0

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN CI=1 pnpm fetch
RUN CI=1 pnpm install -r --offline

EXPOSE 4221

CMD pnpm --filter "./packages/realm-server" $prerender_script
