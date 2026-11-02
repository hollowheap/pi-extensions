import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import {
  formatModelId,
  getRuntimeModels,
  isModelAvailable,
  resolveSubagentModel,
} from "./swap.js";
import { createSubagentTool } from "./tool.js";

const mocks = vi.hoisted(() => ({
  getAgentDir: vi.fn(),
  listSubagents: vi.fn(),
  readSubagentLog: vi.fn(),
  discoverAgents: vi.fn(),
  loadSubagentsConfig: vi.fn(),
  startSubagent: vi.fn(),
  sendSubagent: vi.fn(),
  attachSubagent: vi.fn(),
  abortSubagent: vi.fn(),
  waitSubagent: vi.fn(),
  generateSubagentId: vi.fn(),
}));

vi.mock("./runner.js", () => ({
  startSubagent: mocks.startSubagent,
  attachSubagent: mocks.attachSubagent,
  sendSubagent: mocks.sendSubagent,
  abortSubagent: mocks.abortSubagent,
  waitSubagent: mocks.waitSubagent,
  listSubagents: mocks.listSubagents,
  readSubagentLog: mocks.readSubagentLog,
  generateSubagentId: mocks.generateSubagentId,
}));

vi.mock("./agents.js", () => ({
  discoverAgents: mocks.discoverAgents,
}));

vi.mock("./config.js", () => ({
  loadSubagentsConfig: mocks.loadSubagentsConfig,
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, getAgentDir: mocks.getAgentDir };
});

const baseAgent: AgentConfig = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user",
  filePath: "/tmp/scout.md",
};

function started(params: { model?: string }) {
  return {
    id: "sub-1",
    status: "running" as const,
    agent: "scout",
    task: "test",
    depth: 1,
    attempt: 1,
    startedAt: 1,
    socket: "/tmp/sub.sock",
    ...(params.model !== undefined ? { model: params.model } : {}),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAgentDir.mockReturnValue("/tmp/pi-subagents-test");
  mocks.listSubagents.mockResolvedValue([]);
  mocks.readSubagentLog.mockReturnValue("");
  mocks.discoverAgents.mockReturnValue({ agents: [baseAgent] });
  mocks.loadSubagentsConfig.mockReturnValue({
    maxConcurrent: 4,
    maxDepth: 1,
    defaultTimeoutMs: 30 * 60 * 1_000,
    writeLockTimeoutMs: 30_000,
    path: "/tmp/subagents.json",
    diagnostics: [],
  });
  mocks.startSubagent.mockImplementation(async (params) => started(params));
  mocks.sendSubagent.mockResolvedValue(undefined);
  mocks.attachSubagent.mockResolvedValue(undefined);
  mocks.abortSubagent.mockResolvedValue(undefined);
  mocks.waitSubagent.mockResolvedValue(undefined);
  mocks.generateSubagentId.mockReturnValue("sub-1");
});

describe("swap helper unit tests", () => {
  it("formats model ids from string or object", () => {
    expect(formatModelId("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(
      formatModelId({ provider: "anthropic", id: "claude-3-5-sonnet" }),
    ).toBe("anthropic/claude-3-5-sonnet");
    expect(formatModelId({ provider: "openai", id: "openai/gpt-4o" })).toBe(
      "openai/gpt-4o",
    );
    expect(formatModelId({ id: "gpt-4o" })).toBe("gpt-4o");
    expect(formatModelId(undefined)).toBe("");
    expect(formatModelId(null)).toBe("");
  });

  it("checks model availability case-insensitively with provider prefix tolerance", () => {
    const available = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"];
    expect(isModelAvailable("openai/gpt-4o", available)).toBe(true);
    expect(isModelAvailable("gpt-4o", available)).toBe(true);
    expect(isModelAvailable("claude-3-5-sonnet", available)).toBe(true);
    expect(isModelAvailable("opencode-go/beam-free", available)).toBe(false);
  });

  it("retrieves runtime models combining session model and modelRegistry", async () => {
    const ctx = {
      model: { provider: "openai", id: "gpt-4o" },
      modelRegistry: {
        getAvailable: vi.fn(async () => [
          { provider: "anthropic", id: "claude-3-5-sonnet" },
          "google/gemini-2.5-flash",
        ]),
      },
    };
    const models = await getRuntimeModels(ctx);
    expect(models).toEqual([
      "openai/gpt-4o",
      "anthropic/claude-3-5-sonnet",
      "google/gemini-2.5-flash",
    ]);
  });

  it("returns undefined when agent has no model specified", async () => {
    const ctx = { model: "openai/gpt-4o" };
    const result = await resolveSubagentModel(baseAgent, ctx);
    expect(result).toBeUndefined();
  });

  it("returns agent.model directly when available", async () => {
    const agent: AgentConfig = { ...baseAgent, model: "openai/gpt-4o" };
    const ctx = {
      model: "openai/gpt-4o",
      modelRegistry: {
        getAvailable: vi.fn(async () => ["openai/gpt-4o"]),
      },
    };
    const select = vi.fn();
    const result = await resolveSubagentModel(agent, ctx, { select });
    expect(result).toBe("openai/gpt-4o");
    expect(select).not.toHaveBeenCalled();
  });

  it("prompts user with ctx.ui.select when model is unavailable", async () => {
    const agent: AgentConfig = {
      ...baseAgent,
      model: "opencode-go/beam-free",
    };
    const ctx = {
      model: { provider: "anthropic", id: "claude-3-5-haiku" },
      hasUI: true,
      modelRegistry: {
        getAvailable: vi.fn(async () => [
          "anthropic/claude-3-5-haiku",
          "openai/gpt-4o",
        ]),
      },
    };
    const select = vi.fn(async () => "openai/gpt-4o");
    const result = await resolveSubagentModel(agent, ctx, { select });
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining(
        'Subagent "scout" requests model "opencode-go/beam-free" which is unavailable',
      ),
      ["anthropic/claude-3-5-haiku", "openai/gpt-4o"],
    );
    expect(result).toBe("openai/gpt-4o");
  });

  it("falls back to session model when user cancels interactive selection", async () => {
    const agent: AgentConfig = {
      ...baseAgent,
      model: "opencode-go/beam-free",
    };
    const ctx = {
      model: "anthropic/claude-3-5-haiku",
      hasUI: true,
      modelRegistry: {
        getAvailable: vi.fn(async () => ["anthropic/claude-3-5-haiku"]),
      },
    };
    const select = vi.fn(async () => undefined); // User cancels
    const result = await resolveSubagentModel(agent, ctx, { select });
    expect(result).toBe("anthropic/claude-3-5-haiku");
  });

  it("falls back to session model in headless environment without UI", async () => {
    const agent: AgentConfig = {
      ...baseAgent,
      model: "opencode-go/beam-free",
    };
    const ctx = {
      model: "anthropic/claude-3-5-haiku",
      hasUI: false,
    };
    const result = await resolveSubagentModel(agent, ctx);
    expect(result).toBe("anthropic/claude-3-5-haiku");
  });
});

describe("subagent tool model swap integration and caller parameter guard", () => {
  it("ignores caller model argument in tool parameters and uses frontmatter model", async () => {
    const agentWithModel: AgentConfig = {
      ...baseAgent,
      model: "anthropic/claude-3-5-sonnet",
    };
    mocks.discoverAgents.mockReturnValue({ agents: [agentWithModel] });

    const tool = createSubagentTool();
    const ctx = {
      cwd: "/repo",
      isProjectTrusted: () => true,
      model: "openai/gpt-4o",
      modelRegistry: {
        getAvailable: async () => [
          "openai/gpt-4o",
          "anthropic/claude-3-5-sonnet",
        ],
      },
    };

    // Caller attempts to inject { model: "malicious/override-model" }
    await tool.execute(
      "1",
      {
        action: "start",
        agent: "scout",
        task: "investigate",
        model: "malicious/override-model",
      } as never,
      undefined,
      undefined,
      ctx as never,
    );

    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "anthropic/claude-3-5-sonnet",
      }),
    );
  });

  it("swaps unavailable subagent model before child spawn", async () => {
    const agentWithBadModel: AgentConfig = {
      ...baseAgent,
      model: "opencode-go/beam-free",
    };
    mocks.discoverAgents.mockReturnValue({ agents: [agentWithBadModel] });

    const tool = createSubagentTool();
    const ctx = {
      cwd: "/repo",
      isProjectTrusted: () => true,
      model: "openai/gpt-4o",
      hasUI: true,
      modelRegistry: {
        getAvailable: async () => ["openai/gpt-4o"],
      },
      ui: {
        select: vi.fn(async () => "openai/gpt-4o"),
      },
    };

    await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "investigate" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(ctx.ui.select).toHaveBeenCalled();
    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
      }),
    );
  });

  it("preserves swapped model on resume action", async () => {
    const agent: AgentConfig = {
      ...baseAgent,
      model: "opencode-go/beam-free",
    };
    mocks.discoverAgents.mockReturnValue({ agents: [agent] });
    mocks.attachSubagent.mockResolvedValue({
      id: "sub-1",
      status: "failed",
      agent: "scout",
      task: "resumed task",
      depth: 1,
      attempt: 1,
      startedAt: 1,
      model: "swapped/active-model",
    });

    const tool = createSubagentTool();
    const ctx = {
      cwd: "/repo",
      isProjectTrusted: () => true,
      model: "openai/gpt-4o",
      modelRegistry: {
        getAvailable: async () => ["openai/gpt-4o", "swapped/active-model"],
      },
    };

    await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "swapped/active-model",
      }),
    );
  });
});
