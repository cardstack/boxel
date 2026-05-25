# syntax=docker/dockerfile:1

FROM node:24.13.1-slim
ARG prerender_script
ENV prerender_script=$prerender_script

WORKDIR /realm-server

# Install Chrome dependencies required by Puppeteer; the google-chrome package
# drags in the shared libraries that Chromium needs at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
        jq \
        wget \
        gnupg \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnss3 \
        libnspr4 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxrandr2 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        fonts-ipafont-gothic \
        fonts-wqy-zenhei \
        fonts-thai-tlwg \
        fonts-kacst \
        fonts-freefont-ttf \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.0.9

RUN groupadd -r pptruser \
    && useradd -r -m -d /home/pptruser -g pptruser -G audio,video pptruser

ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_DISABLE_SANDBOX=true
ENV PUPPETEER_CHROME_ARGS="--disable-dev-shm-usage"

RUN mkdir -p /home/pptruser/Downloads "${PUPPETEER_CACHE_DIR}"

# Cache-friendly dependency fetch: this layer only re-runs when the lockfile
# (or patches it references) changes, not on every source edit. `pnpm fetch`
# populates the global pnpm store in $HOME from the lockfile alone, so the
# subsequent `pnpm install --offline` doesn't need the registry.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches
RUN CI=1 pnpm fetch

COPY . ./
RUN CI=1 pnpm install -r --offline
RUN chown -R pptruser:pptruser /home/pptruser /realm-server

USER pptruser

EXPOSE 4221

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl --fail --silent --show-error --max-time 5 --output /dev/null http://localhost:4221/ || exit 1

CMD exec /realm-server/packages/realm-server/$prerender_script
