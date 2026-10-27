import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import {
  formatModelId,
  getRuntimeModels,
  isModelAvailable,
  resolveSubagentModel,
} from "./swap.js";
import { type SubagentToolDeps, createSubagentTool } from "./tool.js";

const baseAgent: AgentConfig = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user",
  filePath: "/tmp/scout.md",
};

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
    const start = vi.fn(async (params) => ({
      id: "sub-1",
      status: "running" as const,
      agent: "scout",
      task: "test",
      depth: 1,
      attempt: 1,
      startedAt: 1,
      socket: "/tmp/sub.sock",
      model: params.model,
    }));

    const deps: Partial<SubagentToolDeps> = {
      getAgentDir: () => "/tmp/pi-subagents-test",
      list: (() => []) as never,
      log: (() => "") as never,
      agents: (() => ({ agents: [agentWithModel] })) as never,
      childSpec: ((a: AgentConfig) => ({
        command: "pi",
        args: a.model ? ["--model", a.model] : [],
      })) as never,
      start: start as never,
      send: vi.fn(async () => undefined) as never,
      resolveModel: vi.fn(async (a: AgentConfig) => a.model),
    };

    const tool = createSubagentTool(deps);
    const ctx = {
      cwd: "/repo",
      isProjectTrusted: () => true,
      model: "openai/gpt-4o",
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

    expect(start).toHaveBeenCalledWith(
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
    const start = vi.fn(async (params) => ({
      id: "sub-1",
      status: "running" as const,
      agent: "scout",
      task: "test",
      depth: 1,
      attempt: 1,
      startedAt: 1,
      socket: "/tmp/sub.sock",
      model: params.model,
    }));

    const deps: Partial<SubagentToolDeps> = {
      getAgentDir: () => "/tmp/pi-subagents-test",
      list: (() => []) as never,
      log: (() => "") as never,
      agents: (() => ({ agents: [agentWithBadModel] })) as never,
      childSpec: ((a: AgentConfig) => ({
        command: "pi",
        args: a.model ? ["--model", a.model] : [],
      })) as never,
      start: start as never,
      send: vi.fn(async () => undefined) as never,
      resolveModel: vi.fn(async () => "openai/gpt-4o"),
    };

    const tool = createSubagentTool(deps);
    const ctx = {
      cwd: "/repo",
      isProjectTrusted: () => true,
      model: "openai/gpt-4o",
    };

    await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "investigate" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(deps.resolveModel).toHaveBeenCalledWith(agentWithBadModel, ctx);
    expect(start).toHaveBeenCalledWith(
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
    const start = vi.fn(async (params) => ({
      id: "sub-1",
      status: "running" as const,
      agent: "scout",
      task: "resumed task",
      depth: 1,
      attempt: 2,
      startedAt: 1,
      socket: "/tmp/sub.sock",
      model: params.model,
    }));

    const deps: Partial<SubagentToolDeps> = {
      getAgentDir: () => "/tmp/pi-subagents-test",
      list: (() => []) as never,
      log: (() => "") as never,
      agents: (() => ({ agents: [agent] })) as never,
      attach: (async () => ({
        id: "sub-1",
        status: "failed" as const,
        agent: "scout",
        task: "resumed task",
        depth: 1,
        attempt: 1,
        startedAt: 1,
        model: "swapped/active-model",
      })) as never,
      childSpec: ((a: AgentConfig) => ({
        command: "pi",
        args: a.model ? ["--model", a.model] : [],
      })) as never,
      start: start as never,
      send: vi.fn(async () => undefined) as never,
      resolveModel: vi.fn(async (a: AgentConfig) => a.model),
    };

    const tool = createSubagentTool(deps);
    const ctx = {
      cwd: "/repo",
      isProjectTrusted: () => true,
      model: "openai/gpt-4o",
    };

    await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "swapped/active-model",
      }),
    );
  });
});
