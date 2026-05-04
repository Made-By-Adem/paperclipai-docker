# CLI Reference

AgentsAI CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm agentsai --help
```

First-time local bootstrap + run:

```sh
pnpm agentsai run
```

Choose local instance:

```sh
pnpm agentsai run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `agentsai onboard` and `agentsai configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `agentsai run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `PAPERCLIP_DEPLOYMENT_MODE`
- `agentsai run` and `agentsai doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm agentsai allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm agentsai env-lab up
pnpm agentsai env-lab doctor
pnpm agentsai env-lab status --json
pnpm agentsai env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.agentsai`:

```sh
pnpm agentsai run --data-dir ./tmp/agentsai-dev
pnpm agentsai issue list --data-dir ./tmp/agentsai-dev
```

## Context Profiles

Store local defaults in `~/.agentsai/context.json`:

```sh
pnpm agentsai context set --api-base http://localhost:3100 --company-id <company-id>
pnpm agentsai context show
pnpm agentsai context list
pnpm agentsai context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm agentsai context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

## Company Commands

```sh
pnpm agentsai company list
pnpm agentsai company get <company-id>
pnpm agentsai company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm agentsai company delete PAP --yes --confirm PAP
pnpm agentsai company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `PAPERCLIP_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `PAPERCLIP_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm agentsai issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm agentsai issue get <issue-id-or-identifier>
pnpm agentsai issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm agentsai issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm agentsai issue comment <issue-id> --body "..." [--reopen]
pnpm agentsai issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm agentsai issue release <issue-id>
```

## Agent Commands

```sh
pnpm agentsai agent list --company-id <company-id>
pnpm agentsai agent get <agent-id>
pnpm agentsai agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

`agent local-cli` is the quickest way to run local Claude/Codex manually as a AgentsAI agent:

- creates a new long-lived agent API key
- installs missing AgentsAI skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID`, and `PAPERCLIP_API_KEY`

Example for shortname-based local setup:

```sh
pnpm agentsai agent local-cli codexcoder --company-id <company-id>
pnpm agentsai agent local-cli claudecoder --company-id <company-id>
```

## Approval Commands

```sh
pnpm agentsai approval list --company-id <company-id> [--status pending]
pnpm agentsai approval get <approval-id>
pnpm agentsai approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm agentsai approval approve <approval-id> [--decision-note "..."]
pnpm agentsai approval reject <approval-id> [--decision-note "..."]
pnpm agentsai approval request-revision <approval-id> [--decision-note "..."]
pnpm agentsai approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm agentsai approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm agentsai activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm agentsai dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm agentsai heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.agentsai/instances/default`:

- config: `~/.agentsai/instances/default/config.json`
- embedded db: `~/.agentsai/instances/default/db`
- logs: `~/.agentsai/instances/default/logs`
- storage: `~/.agentsai/instances/default/data/storage`
- secrets key: `~/.agentsai/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm agentsai run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm agentsai configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
