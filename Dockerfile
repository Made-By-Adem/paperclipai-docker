# =============================================================================
# Paperclip - Multi-stage Docker build
# Builds from source: https://github.com/paperclipai/paperclip
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

# --- Stage 2: Clone repo and install dependencies ---
FROM base AS deps
WORKDIR /app

# Pinned upstream revision. Bump deliberately — an unpinned clone silently
# changes what gets built, and a cached layer keeps serving a stale checkout.
# 8316ceb adds the Better Auth `issuer` column to the Drizzle account schema
# (upstream #12396); without it Better Auth 1.7 emits broken SQL and sign-in
# fails with a 500. Later main currently breaks on the semantic-action-catalog
# check, so stay on this revision until that is fixed upstream.
ARG PAPERCLIP_REF=8316ceb0b9cf5f119381e7ff0f9a9f1a65f9eac0

RUN git init -q . \
  && git remote add origin https://github.com/paperclipai/paperclip.git \
  && git fetch --depth 1 origin "$PAPERCLIP_REF" \
  && git checkout -q FETCH_HEAD \
  && pnpm install --frozen-lockfile

# --- Stage 3: Build all packages ---
FROM deps AS build
WORKDIR /app

# @paperclipai/paperclip-runner compiles a Rust binary (paperclip-runnerd) as
# part of the server build. Matches the toolchain upstream's own Dockerfile uses.
RUN apt-get update \
  && apt-get install -y --no-install-recommends cargo rustc \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS=--max-old-space-size=4096

RUN pnpm --filter @paperclipai/ui build \
  && pnpm --filter @paperclipai/plugin-sdk build \
  && pnpm --filter @paperclipai/server build \
  && test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

# Cargo's target dir is multiple GB and the staged binary already lives in
# packages/paperclip-runner/dist/bin — drop it before the production copy.
RUN rm -rf packages/paperclip-runner/runner/target

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
