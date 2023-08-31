# syntax=docker/dockerfile:1

FROM node:18.6.0-slim
WORKDIR /ai-bot

RUN apt-get update && apt-get install -y ca-certificates

RUN npm install -g pnpm@8.5.1

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN CI=1 pnpm fetch
RUN CI=1 pnpm install -r --offline


CMD pnpm --filter "./packages/ai-bot" start
