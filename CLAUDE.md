# CLAUDE.md

## Project

Paperclip — Self-hosted deployment via Docker with PostgreSQL and Cloudflare Tunnel.
Source: https://github.com/MadeByAdem/paperclipai-docker

## Build & Run

```bash
cp .env.example .env
# Fill in .env with your values
docker compose up --build -d
```

## Architecture

- `Dockerfile` — Multi-stage build: clones repo, installs deps, builds, creates production image
- `docker-compose.yaml` — 2 services: PostgreSQL 17, Paperclip server (localhost:3100)
- `docker-entrypoint.sh` — UID/GID matching for volume permissions
- Server binds to 127.0.0.1:3100 only — a reverse proxy (e.g. cloudflared) on the host routes external traffic


## Worklog
- Project tag: MBA
- Default Work Items db: 97146223-e699-4e67-af62-bcb2fbbd2eae
- Branch convention: <type>/<item-id>-short-title