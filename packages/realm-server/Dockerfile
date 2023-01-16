# syntax=docker/dockerfile:1

FROM node:18

WORKDIR /realm-server

# FIXME 7.2 doesn’t exist, is it bad?
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm

# pnpm fetch does require only lockfile
COPY pnpm-lock.yaml ./

COPY vendor/ ./vendor

RUN pnpm fetch --prod


ADD . ./
RUN pnpm install -r --offline --prod

EXPOSE 3000
# FIXME this is hardcoded to be base-esque
CMD [ "ts-node", "--transpileOnly", "packages/realm-server/main", "--port=3000", "--path='./tests/cards'", "--fromUrl='/node-test/'", "--toUrl='/node-test/'", "--path='../host/tests/cards'" "--fromUrl='https://cardstack.com/base/'", "--toUrl='/base" ]

