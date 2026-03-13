FROM mcr.microsoft.com/devcontainers/javascript-node:22

# pnpm is pre-installed in the devcontainer image; ensure correct version
RUN corepack enable && corepack prepare pnpm@latest --activate

# mise for runtime management
RUN curl https://mise.run | sh && \
    echo 'eval "$(~/.local/bin/mise activate bash)"' >> /home/node/.bashrc

# System dependencies for Synapse (uses Docker) and node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
