FROM node:20.19.1-slim
ARG CI=1
RUN apt-get update && apt-get install -y python3 build-essential
RUN npm install -g pnpm@10.9.0
WORKDIR /boxel
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /boxel/packages/ai-bot
ENTRYPOINT ["pnpm", "start"]
