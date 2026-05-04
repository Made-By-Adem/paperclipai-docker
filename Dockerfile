# =============================================================================
# AgentsAI - Multi-stage Docker build
# Builds from source: https://github.com/nitesh-okra/agents-ai
# =============================================================================

# --- Stage 1: Base image with system dependencies ---
FROM node:lts-trixie-slim AS base

ARG USER_UID=1000
ARG USER_GID=1000

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    gosu \
    curl \
    git \
    wget \
    ripgrep \
    python3 \
  # Install GitHub CLI
  && mkdir -p -m 755 /etc/apt/keyrings \
  && wget -nv -O/etc/apt/keyrings/githubcli-archive-keyring.gpg \
    https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# Match host UID/GID for volume permissions
RUN usermod -u $USER_UID --non-unique node \
  && groupmod -g $USER_GID --non-unique node \
  && usermod -g $USER_GID -d /paperclip node

# --- Stage 2: Copy local source and install dependencies ---
FROM base AS deps
WORKDIR /app

COPY agents-ai/ .
RUN rm -f pnpm-lock.yaml && pnpm install

# --- Stage 3: Build all packages ---
FROM deps AS build
WORKDIR /app

RUN pnpm --filter @agentsai/ui build \
  && pnpm --filter @agentsai/plugin-sdk build \
  && pnpm --filter @agentsai/server build \
  && test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

# --- Stage 4: Production image ---
FROM base AS production

ARG USER_UID=1000
ARG USER_GID=1000

WORKDIR /app
COPY --chown=node:node --from=build /app /app

# Install global AI agent CLI tools
RUN npm install --global --omit=dev \
    @anthropic-ai/claude-code@latest \
    @openai/codex@latest \
    opencode-ai \
  && mkdir -p /paperclip \
  && chown node:node /paperclip

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  USER_UID=${USER_UID} \
  USER_GID=${USER_GID} \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  OPENCODE_ALLOW_ALL_MODELS=true

VOLUME ["/paperclip"]
EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
