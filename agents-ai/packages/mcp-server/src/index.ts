import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentsApiClient } from "./client.js";
import { readConfigFromEnv, type AgentsMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createAgentsMcpServer(config: AgentsMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "Agents",
    version: "0.1.0",
  });

  const client = new AgentsApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: AgentsMcpConfig = readConfigFromEnv()) {
  const { server } = createAgentsMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
