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

# Upstream revision to build. "latest" resolves to the newest vX.Y.Z release
# tag; pass a tag or commit SHA via --build-arg to pin a specific revision.
ARG PAPERCLIP_REF=latest

# The release tag list is re-fetched on every build and only changes when a new
# tag is published, so it invalidates the cached clone exactly when needed —
# a plain `git fetch` layer would keep serving the first checkout forever.
ADD https://api.github.com/repos/paperclipai/paperclip/git/matching-refs/tags/v /tmp/paperclip-tags.json

RUN ref="$PAPERCLIP_REF" \
  && if [ "$ref" = latest ]; then \
    ref=$(node -e ' \
      const tags = require("/tmp/paperclip-tags.json") \
        .map(r => r.ref.replace("refs/tags/", "")) \
        .filter(t => /^v\d+\.\d+\.\d+$/.test(t)) \
        .sort((a, b) => { \
          const x = a.slice(1).split(".").map(Number), y = b.slice(1).split(".").map(Number); \
          return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; \
        }); \
      if (!tags.length) process.exit(1); \
      console.log(tags.at(-1));'); \
  fi \
  && echo "Building paperclip $ref" \
  && git init -q . \
  && git remote add origin https://github.com/paperclipai/paperclip.git \
  && git fetch --depth 1 origin "$ref" \
  && git checkout -q FETCH_HEAD \
  && pnpm install --frozen-lockfile

# --- Stage 3: Build all packages ---
FROM deps AS build
WORKDIR /app

# @paperclipai/paperclip-runner compiles a Rust binary (paperclip-runnerd) as
# part of the server build. Debian's packaged rustc lags the runner's crates
# (trixie ships 1.85), so mirror upstream's Dockerfile: install a pinned,
# checksum-verified rustup and let the runner's rust-toolchain.toml pick the
# compiler. rustup doesn't pull in a C toolchain the way apt's cargo did.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc libc6-dev pkg-config \
  && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
ARG RUSTUP_VERSION=1.29.0
ARG RUSTUP_SHA256_AMD64=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10
ARG RUSTUP_SHA256_ARM64=9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) rustTarget="x86_64-unknown-linux-gnu"; sha256="$RUSTUP_SHA256_AMD64" ;; \
      arm64) rustTarget="aarch64-unknown-linux-gnu"; sha256="$RUSTUP_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/rustup-init "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${rustTarget}/rustup-init"; \
    echo "${sha256}  /tmp/rustup-init" | sha256sum -c -; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain none; \
    rm /tmp/rustup-init; \
    cd packages/paperclip-runner && rustup show

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
