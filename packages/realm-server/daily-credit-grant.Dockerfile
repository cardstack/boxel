# syntax=docker/dockerfile:1

FROM node:22.20.0-slim
ARG daily_credit_grant_script
ENV daily_credit_grant_script=$daily_credit_grant_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip postgresql jq
RUN npm install -g pnpm@10.17.0

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN CI=1 pnpm fetch
RUN CI=1 pnpm install -r --offline

CMD pnpm --filter "./packages/realm-server" $daily_credit_grant_script
