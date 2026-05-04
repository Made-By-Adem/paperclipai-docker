# AgentsAI MCP Server

Model Context Protocol server for AgentsAI.

This package is a thin MCP wrapper over the existing AgentsAI REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PAPERCLIP_API_URL` - AgentsAI base URL, for example `http://localhost:3100`
- `PAPERCLIP_API_KEY` - bearer token used for `/api` requests
- `PAPERCLIP_COMPANY_ID` - optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` - optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` - optional run id forwarded on mutating requests

## Usage

```sh
npx -y @agentsai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @agentsai/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Read tools:

- `agentsaiMe`
- `agentsaiInboxLite`
- `agentsaiListAgents`
- `agentsaiGetAgent`
- `agentsaiListIssues`
- `agentsaiGetIssue`
- `agentsaiGetHeartbeatContext`
- `agentsaiListComments`
- `agentsaiGetComment`
- `agentsaiListIssueApprovals`
- `agentsaiListDocuments`
- `agentsaiGetDocument`
- `agentsaiListDocumentRevisions`
- `agentsaiListProjects`
- `agentsaiGetProject`
- `agentsaiGetIssueWorkspaceRuntime`
- `agentsaiWaitForIssueWorkspaceService`
- `agentsaiListGoals`
- `agentsaiGetGoal`
- `agentsaiListApprovals`
- `agentsaiGetApproval`
- `agentsaiGetApprovalIssues`
- `agentsaiListApprovalComments`

Write tools:

- `agentsaiCreateIssue`
- `agentsaiUpdateIssue`
- `agentsaiCheckoutIssue`
- `agentsaiReleaseIssue`
- `agentsaiAddComment`
- `agentsaiSuggestTasks`
- `agentsaiAskUserQuestions`
- `agentsaiRequestConfirmation`
- `agentsaiUpsertIssueDocument`
- `agentsaiRestoreIssueDocumentRevision`
- `agentsaiControlIssueWorkspaceServices`
- `agentsaiCreateApproval`
- `agentsaiLinkIssueApproval`
- `agentsaiUnlinkIssueApproval`
- `agentsaiApprovalDecision`
- `agentsaiAddApprovalComment`

Escape hatch:

- `agentsaiApiRequest`

`agentsaiApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.
