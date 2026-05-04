import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCodexSkills,
  syncCodexSkills,
} from "@agentsai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("codex local skill sync", () => {
  const AgentsKey = "Agentsai/Agents/Agents";
  const createAgentKey = "Agentsai/Agents/Agents-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Agents skills for workspace injection on the next run", async () => {
    const codexHome = await makeTempDir("Agents-codex-skill-sync-");
    cleanupDirs.add(codexHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        AgentsSkillSync: {
          desiredSkills: [AgentsKey],
        },
      },
    } as const;

    const before = await listCodexSkills(ctx);
    expect(before.mode).toBe("ephemeral");
    expect(before.desiredSkills).toContain(AgentsKey);
    expect(before.desiredSkills).toContain(createAgentKey);
    expect(before.entries.find((entry) => entry.key === AgentsKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === createAgentKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === createAgentKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === AgentsKey)?.detail).toContain("CODEX_HOME/skills/");
  });

  it("does not persist Agents skills into CODEX_HOME during sync", async () => {
    const codexHome = await makeTempDir("Agents-codex-skill-prune-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        AgentsSkillSync: {
          desiredSkills: [AgentsKey],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, [AgentsKey]);
    expect(after.mode).toBe("ephemeral");
    expect(after.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("configured");
    await expect(fs.lstat(path.join(codexHome, "skills", "Agents"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps required bundled Agents skills configured even when the desired set is emptied", async () => {
    const codexHome = await makeTempDir("Agents-codex-skill-required-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        AgentsSkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, []);
    expect(after.desiredSkills).toContain(AgentsKey);
    expect(after.desiredSkills).toContain(createAgentKey);
    expect(after.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("configured");
    expect(after.entries.find((entry) => entry.key === createAgentKey)?.state).toBe("configured");
  });

  it("normalizes legacy flat Agents skill refs before reporting configured state", async () => {
    const codexHome = await makeTempDir("Agents-codex-legacy-skill-sync-");
    cleanupDirs.add(codexHome);

    const snapshot = await listCodexSkills({
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        AgentsSkillSync: {
          desiredSkills: ["Agents"],
        },
      },
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.desiredSkills).toContain(AgentsKey);
    expect(snapshot.desiredSkills).not.toContain("Agents");
    expect(snapshot.entries.find((entry) => entry.key === AgentsKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === "Agents")).toBeUndefined();
  });
});
