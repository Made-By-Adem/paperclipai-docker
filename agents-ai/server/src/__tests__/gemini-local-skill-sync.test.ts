import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listGeminiSkills,
  syncGeminiSkills,
} from "@agentsai/adapter-gemini-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("gemini local skill sync", () => {
  const AgentsKey = "Agentsai/Agents/Agents";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Agents skills and installs them into the Gemini skills home", async () => {
    const home = await makeTempDir("Agents-gemini-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "gemini_local",
      config: {
        env: {
          HOME: home,
        },
        AgentsSkillSync: {
          desiredSkills: [AgentsKey],
        },
      },
    } as const;

    const before = await listGeminiSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(AgentsKey);
    expect(before.entries.find((entry) => entry.key === AgentsKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("missing");

    const after = await syncGeminiSkills(ctx, [AgentsKey]);
    expect(after.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".gemini", "skills", "Agents"))).isSymbolicLink()).toBe(true);
  });

  it("keeps required bundled Agents skills installed even when the desired set is emptied", async () => {
    const home = await makeTempDir("Agents-gemini-skill-prune-");
    cleanupDirs.add(home);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "gemini_local",
      config: {
        env: {
          HOME: home,
        },
        AgentsSkillSync: {
          desiredSkills: [AgentsKey],
        },
      },
    } as const;

    await syncGeminiSkills(configuredCtx, [AgentsKey]);

    const clearedCtx = {
      ...configuredCtx,
      config: {
        env: {
          HOME: home,
        },
        AgentsSkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncGeminiSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(AgentsKey);
    expect(after.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".gemini", "skills", "Agents"))).isSymbolicLink()).toBe(true);
  });
});
