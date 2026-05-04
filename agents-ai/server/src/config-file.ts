import fs from "node:fs";
import { AgentsConfigSchema, type AgentsConfig } from "@agentsai/shared";
import { resolveAgentsConfigPath } from "./paths.js";

export function readConfigFile(): AgentsConfig | null {
  const configPath = resolveAgentsConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return AgentsConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
