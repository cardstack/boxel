# syntax=docker/dockerfile:1

FROM node:24.22.1-slim
ARG prerender_script
ENV prerender_script=$prerender_script

WORKDIR /realm-server

# The oldest Chrome this image may ship. The prerenderer loads card HTML from
# any realm, so its browser must carry Chrome's security fixes, and the build
# fails when the apt repository serves something older. Docker reuses the
# install layer below from the registry build cache until something it depends
# on changes; this value is one of those inputs. When a Chrome security release
# lands, raise it to the fixed version: the layer then reinstalls from the
# current stable package instead of keeping the cached browser. Raise the
# Chrome for Testing pin in the repo-root `.puppeteerrc.cjs` along with it:
# that pin is the browser Puppeteer launches on machines with no installed
# Chrome, and it must not fall below this value.
ARG CHROME_MIN_VERSION=156.0.8078.79

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
    && chrome_version="$(dpkg-query -W -f='${Version}' google-chrome-stable)" \
    && if ! dpkg --compare-versions "$chrome_version" ge "$CHROME_MIN_VERSION"; then \
         echo "google-chrome-stable $chrome_version is older than CHROME_MIN_VERSION $CHROME_MIN_VERSION" >&2; \
         exit 1; \
       fi \
    && echo "Installed google-chrome-stable $chrome_version" \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@12.7.0

RUN groupadd -r pptruser \
    && useradd -r -m -d /home/pptruser -g pptruser -G audio,video pptruser

ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_CHROME_ARGS="--disable-dev-shm-usage"

RUN mkdir -p /home/pptruser/Downloads "${PUPPETEER_CACHE_DIR}"

# Cache-friendly dependency fetch: this layer only re-runs when the lockfile,
# the patches it references, or the pnpmfile changes, not on every source edit.
# `pnpm fetch` populates the global pnpm store in $HOME, so the subsequent
# `pnpm install --offline` doesn't need the registry. The pnpmfile belongs here
# because the lockfile records its checksum: a frozen fetch that cannot
# recompute it fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
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
