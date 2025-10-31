# syntax=docker/dockerfile:1

FROM node:24.11.0-slim
ARG worker_script
ENV worker_script=$worker_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip postgresql jq
RUN npm install -g pnpm@10.17.0

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN CI=1 pnpm fetch
RUN CI=1 pnpm install -r --offline

EXPOSE 3000

CMD pnpm --filter "./packages/realm-server" $worker_script
