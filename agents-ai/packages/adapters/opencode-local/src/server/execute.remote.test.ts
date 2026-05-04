import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  runSshCommand,
  syncDirectoryToSsh,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: [
      JSON.stringify({ type: "step_start", sessionID: "session_123" }),
      JSON.stringify({ type: "text", sessionID: "session_123", part: { text: "hello" } }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "session_123",
        part: { cost: 0.001, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
      }),
    ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: opencode"),
  prepareWorkspaceForSshExecution: vi.fn(async () => undefined),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  runSshCommand: vi.fn(async () => ({
    stdout: "/home/agent",
    stderr: "",
    exitCode: 0,
  })),
  syncDirectoryToSsh: vi.fn(async () => undefined),
}));

vi.mock("@agentsai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@agentsai/adapter-utils/server-utils")>(
    "@agentsai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    resolveCommandForLogs,
    runChildProcess,
  };
});

vi.mock("@agentsai/adapter-utils/ssh", async () => {
  const actual = await vi.importActual<typeof import("@agentsai/adapter-utils/ssh")>(
    "@agentsai/adapter-utils/ssh",
  );
  return {
    ...actual,
    prepareWorkspaceForSshExecution,
    restoreWorkspaceFromSshExecution,
    runSshCommand,
    syncDirectoryToSsh,
  };
});

import { execute } from "./execute.js";

describe("opencode remote execution", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("prepares the workspace, syncs OpenCode skills, and restores workspace changes for remote SSH execution", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "Agents-opencode-remote-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OpenCode Builder",
        adapterType: "opencode_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "opencode",
        model: "opencode/gpt-5-nano",
      },
      context: {
        AgentsWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
          AgentsApiUrl: "http://198.51.100.10:3102",
        },
      },
      onLog: async () => {},
    });

    expect(result.sessionParams).toMatchObject({
      sessionId: "session_123",
      cwd: "/remote/workspace",
      remoteExecution: {
        transport: "ssh",
        host: "127.0.0.1",
        port: 2222,
        username: "fixture",
        remoteCwd: "/remote/workspace",
        AgentsApiUrl: "http://198.51.100.10:3102",
      },
    });
    expect(prepareWorkspaceForSshExecution).toHaveBeenCalledTimes(1);
    expect(syncDirectoryToSsh).toHaveBeenCalledTimes(2);
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(expect.objectContaining({
      remoteDir: "/remote/workspace/.Agents-runtime/opencode/xdgConfig",
    }));
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(expect.objectContaining({
      remoteDir: "/remote/workspace/.Agents-runtime/opencode/skills",
      followSymlinks: true,
    }));
    expect(runSshCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(".claude/skills"),
      expect.anything(),
    );
    const call = runChildProcess.mock.calls[0] as unknown as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[3].env.Agents_API_URL).toBe("http://198.51.100.10:3102");
    expect(call?.[3].env.XDG_CONFIG_HOME).toBe("/remote/workspace/.Agents-runtime/opencode/xdgConfig");
    expect(call?.[3].remoteExecution?.remoteCwd).toBe("/remote/workspace");
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledTimes(1);
  });

  it("resumes saved OpenCode sessions for remote SSH execution only when the identity matches", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "Agents-opencode-remote-resume-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await execute({
      runId: "run-ssh-resume",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OpenCode Builder",
        adapterType: "opencode_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "session-123",
        sessionParams: {
          sessionId: "session-123",
          cwd: "/remote/workspace",
          remoteExecution: {
            transport: "ssh",
            host: "127.0.0.1",
            port: 2222,
            username: "fixture",
            remoteCwd: "/remote/workspace",
          },
        },
        sessionDisplayId: "session-123",
        taskKey: null,
      },
      config: {
        command: "opencode",
        model: "opencode/gpt-5-nano",
      },
      context: {
        AgentsWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    const call = runChildProcess.mock.calls[0] as unknown as [string, string, string[]] | undefined;
    expect(call?.[2]).toContain("--session");
    expect(call?.[2]).toContain("session-123");
  });
});
