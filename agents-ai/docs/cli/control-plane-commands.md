---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm agentsai issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm agentsai issue get <issue-id-or-identifier>

# Create issue
pnpm agentsai issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm agentsai issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm agentsai issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm agentsai issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm agentsai issue release <issue-id>
```

## Company Commands

```sh
pnpm agentsai company list
pnpm agentsai company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm agentsai company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm agentsai company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm agentsai company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm agentsai agent list
pnpm agentsai agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm agentsai approval list [--status pending]

# Get approval
pnpm agentsai approval get <approval-id>

# Create approval
pnpm agentsai approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm agentsai approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm agentsai approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm agentsai approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm agentsai approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm agentsai approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm agentsai activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm agentsai dashboard get
```

## Heartbeat

```sh
pnpm agentsai heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
