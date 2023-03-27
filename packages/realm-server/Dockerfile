# syntax=docker/dockerfile:1

FROM node:18-slim
ARG realm_server_script
ENV realm_server_script=$realm_server_script

WORKDIR /realm-server

RUN apt-get update && apt-get install -y ca-certificates curl unzip
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm
RUN tar cfz demo-cards.tar.gz packages/demo-cards

COPY . ./

RUN pnpm fetch
RUN pnpm install -r --offline

EXPOSE 3000

CMD pnpm --filter "./packages/realm-server" $realm_server_script
