# Node major here only needs to be close enough to bootstrap mise; the exact
# toolchain (node + pnpm) is pinned in /.mise.toml and installed by setup.sh.
# Pinned to bookworm: the floating `:24` tag now resolves to Debian trixie,
# which several devcontainer features (notably docker-in-docker's Moby
# packages) don't yet support.
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# mise manages the Node and pnpm versions pinned in the repo's .mise.toml.
# `mise install` is run by .devcontainer/setup.sh once the repo is checked out.
# Install to a global path: this RUN executes as root, so the default
# ~/.local/bin/mise would land under /root and be invisible to the 'node' user
# that Codespaces runs lifecycle commands as. A global binary is on PATH for
# every user; per-user mise data still lives under each user's home.
RUN curl https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh && \
    echo 'eval "$(mise activate bash)"' >> /etc/bash.bashrc

# build-essential for node-gyp; the rest are the shared libraries Chromium
# needs so puppeteer's bundled Chrome can launch for card prerendering
# (the prerender service fails with "libatk-1.0.so.0: cannot open shared
# object file" without them). Postgres, Matrix/Synapse and SMTP run as
# Docker containers via the docker-in-docker feature, so they need nothing here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    libgtk-3-0 libx11-xcb1 libxcb1 libxss1 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
