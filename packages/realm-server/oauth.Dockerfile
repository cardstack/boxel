# syntax=docker/dockerfile:1
FROM node:24.17.0-slim AS dependencies
ENV CI=1 HUSKY=0 PUPPETEER_SKIP_DOWNLOAD=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.7.0
WORKDIR /opt/boxel
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches ./patches
RUN pnpm fetch
# Keep the dependency layer independent of application source changes.
COPY packages/ai-assistant-evals/package.json packages/ai-assistant-evals/
COPY packages/ai-bot/package.json packages/ai-bot/
COPY packages/base/package.json packages/base/
COPY packages/billing/package.json packages/billing/
COPY packages/bot-runner/package.json packages/bot-runner/
COPY packages/boxel-cli/package.json packages/boxel-cli/
COPY packages/boxel-homepage-realm/package.json packages/boxel-homepage-realm/
COPY packages/boxel-icons/package.json packages/boxel-icons/
COPY packages/boxel-ui/docs-app/package.json packages/boxel-ui/docs-app/
COPY packages/boxel-ui/package.json packages/boxel-ui/
COPY packages/bxl/package.json packages/bxl/
COPY packages/catalog/package.json packages/catalog/
COPY packages/choreo/package.json packages/choreo/
COPY packages/choreo-eslint-config/package.json packages/choreo-eslint-config/
COPY packages/choreo-film-app/package.json packages/choreo-film-app/
COPY packages/choreo-gallery/package.json packages/choreo-gallery/
COPY packages/choreo-player/package.json packages/choreo-player/
COPY packages/eslint-plugin-boxel/package.json packages/eslint-plugin-boxel/
COPY packages/eslint-plugin-cardstack-host/package.json packages/eslint-plugin-cardstack-host/
COPY packages/experiments-realm/package.json packages/experiments-realm/
COPY packages/glimmer-motion/package.json packages/glimmer-motion/
COPY packages/host/package.json packages/host/
COPY packages/local-types/package.json packages/local-types/
COPY packages/matrix/package.json packages/matrix/
COPY packages/observability/package.json packages/observability/
COPY packages/openrouter-realm/package.json packages/openrouter-realm/
COPY packages/postgres/package.json packages/postgres/
COPY packages/pretui/package.json packages/pretui/
COPY packages/realm-server/package.json packages/realm-server/
COPY packages/realm-test-harness/package.json packages/realm-test-harness/
COPY packages/runtime-common/package.json packages/runtime-common/
COPY packages/school-example-realm/package.json packages/school-example-realm/
COPY packages/skills-realm/package.json packages/skills-realm/
COPY packages/software-factory/package.json packages/software-factory/
COPY packages/template-lint/package.json packages/template-lint/
COPY packages/test-realm-cards/package.json packages/test-realm-cards/
COPY packages/vscode-boxel-tools/package.json packages/vscode-boxel-tools/
COPY vendor/ember-concurrency-async-plugin/package.json vendor/ember-concurrency-async-plugin/
COPY vendor/transform-modules-amd-plugin/package.json vendor/transform-modules-amd-plugin/
RUN pnpm install --offline --frozen-lockfile
FROM node:24.17.0-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /opt/boxel /opt/boxel
# Source-only iterations no longer recopy/reupload the complete dependency tree.
COPY . /opt/boxel
WORKDIR /opt/boxel/packages/realm-server
ENV NODE_ENV=production NODE_NO_WARNINGS=1 LOG_LEVELS=*=warn
EXPOSE 3000
CMD ["node", "oauth-main.ts"]
