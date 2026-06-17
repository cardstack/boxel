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

# System dependencies for node-gyp. Postgres, Matrix/Synapse and SMTP run as
# Docker containers (via the docker-in-docker feature) started by the repo's
# own mise tasks — no system packages needed for them here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
