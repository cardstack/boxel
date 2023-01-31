# syntax=docker/dockerfile:1

FROM node:18-alpine
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

# Required for pnpm to install Node on Alpine
RUN apk add build-base libc6-compat gcompat
RUN wget -qO /bin/pnpm "https://github.com/pnpm/pnpm/releases/latest/download/pnpm-linuxstatic-x64" && chmod +x /bin/pnpm

COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

RUN pnpm fetch
RUN pnpm install -r --prefer-offline

EXPOSE 3000

CMD pnpm --filter "./packages/realm-server" $realm_server_script
