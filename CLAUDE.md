# CLAUDE.md

## Project

Agents — feature of the cx-assist platform. Self-hosted via Docker (PostgreSQL + reverse proxy).
Branded as "Agents"; upstream is paperclip/agentsai (do not rebrand internal symbols).
Public URL: agents.cx-assist.io
Upstream source: https://github.com/MadeByAdem/agentsai-docker

## Build & Run

```bash
cp .env.example .env
# Fill in .env with your values
docker compose up --build -d
```

## Architecture

- `Dockerfile` — Multi-stage build: clones repo, installs deps, builds, creates production image
- `docker-compose.yaml` — 2 services: PostgreSQL 17, AgentsAI server (localhost:3100)
- `docker-entrypoint.sh` — UID/GID matching for volume permissions
- Server binds to 127.0.0.1:3100 only — a reverse proxy (e.g. cloudflared) on the host routes external traffic
