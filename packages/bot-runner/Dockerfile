FROM node:22.20.0-slim
ARG CI=1
RUN apt-get update && apt-get install -y python3 build-essential
RUN npm install -g pnpm@10.17.0
WORKDIR /boxel
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/bot-runner
ENTRYPOINT ["pnpm", "start"]
