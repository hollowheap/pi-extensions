import { describe, expect, it, vi } from "vitest";
import { SUBAGENT_DEFINITION_TYPE } from "./definitions.js";
import { createSubagentsExtension } from "./index.js";

const toolMocks = vi.hoisted(() => ({
  options: undefined as
    | {
        getSessionAgents?: () => Array<Record<string, unknown>>;
        defineSessionAgent?: (definition: Record<string, unknown>) => void;
      }
    | undefined,
}));

vi.mock("./tool.js", () => ({
  createSubagentTool: (options: typeof toolMocks.options) => {
    toolMocks.options = options;
    return { execute: vi.fn(), renderCall: vi.fn(), renderResult: vi.fn() };
  },
}));

function createMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    events: { emit: vi.fn() },
  };
}

function handler(pi: ReturnType<typeof createMockPi>, event: string) {
  return pi.on.mock.calls.find(([name]) => name === event)?.[1] as
    | ((event: unknown, ctx: unknown) => void)
    | undefined;
}

describe("pi-subagents session definitions", () => {
  it("persists definitions and restores them from the session branch", () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({
      getAgentDir: () => "/tmp/agent",
      listSubagents: vi.fn().mockResolvedValue([]),
    });
    ext(pi as never);

    const options = toolMocks.options;
    expect(options?.getSessionAgents?.()).toEqual([]);

    const definition = {
      name: "reviewer",
      description: "Reviews changes",
      systemPrompt: "You review code.",
      tools: ["read"],
    };
    options?.defineSessionAgent?.(definition);

    expect(pi.appendEntry).toHaveBeenCalledWith(
      SUBAGENT_DEFINITION_TYPE,
      definition,
    );
    expect(options?.getSessionAgents?.()).toEqual([
      expect.objectContaining({
        ...definition,
        source: "session",
      }),
    ]);

    let branch: unknown[] = [
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: definition,
      },
    ];
    const ctx = {
      sessionManager: { getBranch: () => branch },
    };
    handler(pi, "session_start")?.({}, ctx);
    expect(options?.getSessionAgents?.()).toEqual([
      expect.objectContaining({ name: "reviewer", source: "session" }),
    ]);

    branch = [];
    handler(pi, "session_tree")?.({}, ctx);
    expect(options?.getSessionAgents?.()).toEqual([]);
  });

  it("registers branch restore for session tree navigation", () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({
      getAgentDir: () => "/tmp/agent",
      listSubagents: vi.fn().mockResolvedValue([]),
    });
    ext(pi as never);

    expect(pi.on).toHaveBeenCalledWith("session_tree", expect.any(Function));
  });
});
