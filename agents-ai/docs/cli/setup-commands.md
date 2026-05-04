---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `agentsai run`

One-command bootstrap and start:

```sh
pnpm agentsai run
```

Does:

1. Auto-onboards if config is missing
2. Runs `agentsai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm agentsai run --instance dev
```

## `agentsai onboard`

Interactive first-time setup:

```sh
pnpm agentsai onboard
```

If AgentsAI is already configured, rerunning `onboard` keeps the existing config in place. Use `agentsai configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm agentsai onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm agentsai onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts AgentsAI with that setup.

## `agentsai doctor`

Health checks with optional auto-repair:

```sh
pnpm agentsai doctor
pnpm agentsai doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `agentsai configure`

Update configuration sections:

```sh
pnpm agentsai configure --section server
pnpm agentsai configure --section secrets
pnpm agentsai configure --section storage
```

## `agentsai env`

Show resolved environment configuration:

```sh
pnpm agentsai env
```

This now includes bind-oriented deployment settings such as `PAPERCLIP_BIND` and `PAPERCLIP_BIND_HOST` when configured.

## `agentsai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm agentsai allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.agentsai/instances/default/config.json` |
| Database | `~/.agentsai/instances/default/db` |
| Logs | `~/.agentsai/instances/default/logs` |
| Storage | `~/.agentsai/instances/default/data/storage` |
| Secrets key | `~/.agentsai/instances/default/secrets/master.key` |

Override with:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm agentsai run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm agentsai run --data-dir ./tmp/agentsai-dev
pnpm agentsai doctor --data-dir ./tmp/agentsai-dev
```
