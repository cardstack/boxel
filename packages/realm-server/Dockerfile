# syntax=docker/dockerfile:1

FROM node:18
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

# FIXME 7.2 doesn’t exist, is it bad?
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm

# pnpm fetch does require only lockfile
COPY pnpm-lock.yaml ./

COPY patches/ ./patches
COPY vendor/ ./vendor

ADD . ./

# FIXME see below re --prod
RUN pnpm fetch

# FIXME the documentation says to use --prod but packages/worker has webpack in devDependencies
RUN pnpm install -r --offline

EXPOSE 443

CMD pnpm --filter "./packages/realm-server" $realm_server_script
