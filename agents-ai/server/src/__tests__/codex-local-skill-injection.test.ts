import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@agentsai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createAgentsRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"Agents"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const AgentsKey = "Agentsai/Agents/Agents";
  const createAgentKey = "Agentsai/Agents/Agents-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Agents skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("Agents-codex-current-");
    const oldRepo = await makeTempDir("Agents-codex-old-");
    const skillsHome = await makeTempDir("Agents-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createAgentsRepoSkill(currentRepo, "Agents");
    await createAgentsRepoSkill(currentRepo, "Agents-create-agent");
    await createAgentsRepoSkill(oldRepo, "Agents");
    await fs.symlink(path.join(oldRepo, "skills", "Agents"), path.join(skillsHome, "Agents"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: AgentsKey,
            runtimeName: "Agents",
            source: path.join(currentRepo, "skills", "Agents"),
          },
          {
            key: createAgentKey,
            runtimeName: "Agents-create-agent",
            source: path.join(currentRepo, "skills", "Agents-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "Agents"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "Agents")),
    );
    expect(await fs.realpath(path.join(skillsHome, "Agents-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "Agents-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "Agents"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "Agents-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Agents repo checkouts", async () => {
    const currentRepo = await makeTempDir("Agents-codex-current-");
    const customRoot = await makeTempDir("Agents-codex-custom-");
    const skillsHome = await makeTempDir("Agents-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createAgentsRepoSkill(currentRepo, "Agents");
    await createCustomSkill(customRoot, "Agents");
    await fs.symlink(path.join(customRoot, "custom", "Agents"), path.join(skillsHome, "Agents"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: AgentsKey,
        runtimeName: "Agents",
        source: path.join(currentRepo, "skills", "Agents"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "Agents"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "Agents")),
    );
  });

  it("prunes broken symlinks for unavailable Agents repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("Agents-codex-current-");
    const oldRepo = await makeTempDir("Agents-codex-old-");
    const skillsHome = await makeTempDir("Agents-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createAgentsRepoSkill(currentRepo, "Agents");
    await createAgentsRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: AgentsKey,
          runtimeName: "Agents",
          source: path.join(currentRepo, "skills", "Agents"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Agents skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("Agents-codex-current-");
    const skillsHome = await makeTempDir("Agents-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createAgentsRepoSkill(currentRepo, "Agents");
    await createAgentsRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: AgentsKey,
        runtimeName: "Agents",
        source: path.join(currentRepo, "skills", "Agents"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "Agents"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});
