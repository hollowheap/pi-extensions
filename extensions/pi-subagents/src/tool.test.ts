import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import type { SubagentState } from "./state.js";
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
  resolveSubagentModel: vi.fn(),
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

vi.mock("./swap.js", () => ({
  resolveSubagentModel: mocks.resolveSubagentModel,
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, getAgentDir: mocks.getAgentDir };
});

const agent: AgentConfig = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user",
  filePath: "/tmp/scout.md",
};

const running: SubagentState = {
  id: "sub-1",
  status: "running",
  agent: "scout",
  task: "find",
  depth: 1,
  attempt: 1,
  startedAt: 1,
  socket: "/tmp/sub.sock",
};

function textOf(result: { content: unknown }): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

function detailsOf(result: { details: unknown }): Record<string, unknown> {
  return result.details as Record<string, unknown>;
}

function createTool() {
  return createSubagentTool();
}

const ctx = {
  cwd: "/repo",
  sessionManager: { getSessionId: () => "session-1" },
  isProjectTrusted: () => true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAgentDir.mockReturnValue("/tmp/pi-subagents-tool");
  mocks.listSubagents.mockResolvedValue([]);
  mocks.readSubagentLog.mockReturnValue("");
  mocks.discoverAgents.mockReturnValue({ agents: [agent] });
  mocks.loadSubagentsConfig.mockReturnValue({
    maxConcurrent: 4,
    maxDepth: 1,
    defaultTimeoutMs: 30 * 60 * 1_000,
    writeLockTimeoutMs: 30_000,
    harnesses: {},
    path: "/tmp/subagents.json",
    diagnostics: [],
  });
  mocks.startSubagent.mockResolvedValue(running);
  mocks.sendSubagent.mockResolvedValue(undefined);
  mocks.attachSubagent.mockResolvedValue(running);
  mocks.abortSubagent.mockResolvedValue(undefined);
  mocks.waitSubagent.mockResolvedValue(running);
  mocks.generateSubagentId.mockReturnValue("sub-1");
  mocks.resolveSubagentModel.mockResolvedValue(undefined);
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_SUBAGENT_DEPTH");
});

describe("subagent tool", () => {
  it("stops a TUI wait without cancelling the child", async () => {
    let component:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    const uiCtx = {
      ...ctx,
      mode: "tui",
      hasUI: true,
      ui: {
        notify: vi.fn(),
        custom: vi.fn(
          (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: (result: unknown) => void,
            ) => {
              handleInput(data: string): void;
              render(width: number): string[];
            },
          ) =>
            new Promise((resolve) => {
              component = factory(
                { requestRender: vi.fn() },
                { fg: (_token: string, text: string) => text },
                {},
                resolve,
              );
            }),
        ),
      },
    };
    mocks.waitSubagent
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(running);
    const tool = createTool();

    const pending = tool.execute(
      "1",
      { action: "wait", id: "sub-1", timeoutMs: 10_000 },
      undefined,
      undefined,
      uiCtx as never,
    );
    await vi.waitFor(() => expect(component).toBeDefined());
    component?.handleInput("\x1b");
    const result = await pending;

    expect(textOf(result)).toContain('"waitCancelled":true');
    expect(detailsOf(result).status).toBe("running");
  });

  it("starts a trusted agent and sends the task prompt", async () => {
    const tool = createTool();
    const result = await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "scout",
        task: "find",
        depth: 1,
        parentSession: "session-1",
        env: expect.objectContaining({
          PI_SUBAGENT_DEPTH: "1",
          PI_SUBAGENT_MODE: "ask",
        }),
      }),
    );
    expect(mocks.sendSubagent).toHaveBeenCalledWith(
      "/tmp/pi-subagents-tool",
      "sub-1",
      expect.objectContaining({ type: "prompt", message: "find" }),
    );
    expect(detailsOf(result).status).toBe("running");
  });

  it("defines session agents through the tool", async () => {
    const defineSessionAgent = vi.fn();
    const tool = createSubagentTool({ defineSessionAgent });
    const result = await tool.execute(
      "1",
      {
        action: "define",
        name: " reviewer ",
        description: " Reviews changes ",
        systemPrompt: " You review code. ",
        tools: [" read ", "", "grep"],
        model: "p/m",
        thinking: "high",
        agentMode: "plan",
        effort: "low",
        harness: "claude",
      },
      undefined,
      undefined,
      ctx as never,
    );

    expect(detailsOf(result)).toEqual({
      defined: "reviewer",
      source: "session",
    });
    expect(defineSessionAgent).toHaveBeenCalledWith({
      name: "reviewer",
      description: "Reviews changes",
      systemPrompt: "You review code.",
      tools: ["read", "grep"],
      model: "p/m",
      thinking: "high",
      mode: "plan",
      effort: "low",
      harness: "claude",
    });
  });

  it("starts session agents and prefers them over file agents", async () => {
    const sessionAgent: AgentConfig = {
      name: "scout",
      description: "Session scout",
      systemPrompt: "You are a session scout.",
      tools: ["read"],
      model: "session/model",
      source: "session",
    };
    const tool = createSubagentTool({
      getSessionAgents: () => [sessionAgent],
    });

    const result = await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );

    const spec = mocks.startSubagent.mock.calls[0]?.[0] as {
      args: string[];
      model?: string;
    };
    expect(spec.args).toContain("You are a session scout.");
    expect(spec.args).toContain("session/model");
    expect(spec.args[spec.args.indexOf("--tools") + 1]).toBe("read");
    expect(spec.model).toBe("session/model");
    expect(detailsOf(result).status).toBe("running");
  });

  it("validates session agent definition input", async () => {
    const defineSessionAgent = vi.fn();
    const tool = createSubagentTool({ defineSessionAgent });

    const missingPrompt = await tool.execute(
      "1",
      { action: "define", name: "reviewer" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(missingPrompt)).toContain(
      "define requires name and systemPrompt",
    );

    const missingCallback = await createTool().execute(
      "2",
      {
        action: "define",
        name: "reviewer",
        systemPrompt: "You review.",
      },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(missingCallback)).toContain(
      "session agent definitions are unavailable",
    );
    expect(defineSessionAgent).not.toHaveBeenCalled();
  });

  it("prioritizes parent mode over frontmatter mode, falling back to frontmatter", async () => {
    mocks.discoverAgents.mockReturnValue({
      agents: [
        {
          name: "scout",
          description: "",
          systemPrompt: "",
          source: "user",
          mode: "plan",
          filePath: "/tmp/scout.md",
        },
      ],
      diagnostics: [],
    });
    const tool = createTool();

    // 1. Parent in edit mode overrides agent mode "plan"
    const editOwner = {};
    const { enterMode } = await import("@hollowheap/core");
    enterMode(editOwner, "edit");
    await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      { ...ctx, sessionManager: editOwner } as never,
    );
    expect(mocks.startSubagent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ PI_SUBAGENT_MODE: "edit" }),
      }),
    );

    // 2. Parent in default ask falls back to agent mode "plan"
    const askOwner = {};
    enterMode(askOwner, "ask");
    await tool.execute(
      "2",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      { ...ctx, sessionManager: askOwner } as never,
    );
    expect(mocks.startSubagent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ PI_SUBAGENT_MODE: "plan" }),
      }),
    );
  });

  it("rejects untrusted projects and depth overflow", async () => {
    const tool = createTool();
    const untrusted = await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      { ...ctx, isProjectTrusted: () => false } as never,
    );
    expect(textOf(untrusted)).toContain("trusted project");

    process.env.PI_SUBAGENT_DEPTH = "1";
    const deep = await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(deep)).toContain("exceeds maxDepth");
  });

  it("runs a generic harness with stdin input and raw steering", async () => {
    const harnessAgent: AgentConfig = {
      ...agent,
      harness: "claude",
      systemPrompt: "You are Claude.",
    };
    mocks.discoverAgents.mockReturnValue({ agents: [harnessAgent] });
    mocks.loadSubagentsConfig.mockReturnValue({
      maxConcurrent: 4,
      maxDepth: 1,
      defaultTimeoutMs: 30 * 60 * 1_000,
      writeLockTimeoutMs: 30_000,
      harnesses: {
        claude: { command: "claude", args: ["-p"], input: "stdin" },
      },
      path: "/tmp/subagents.json",
      diagnostics: [],
    });
    const tool = createTool();
    const result = await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "claude",
        args: ["-p"],
        harness: "claude",
        inputMode: "text",
        initialInput: "You are Claude.\n\nfind",
      }),
    );
    expect(mocks.sendSubagent).not.toHaveBeenCalled();
    expect(detailsOf(result).status).toBe("running");

    mocks.attachSubagent.mockResolvedValue({
      ...running,
      harness: "claude",
      inputMode: "text",
    });
    await tool.execute(
      "1",
      { action: "send", id: "sub-1", message: "keep going" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(mocks.sendSubagent).toHaveBeenCalledWith(
      "/tmp/pi-subagents-tool",
      "sub-1",
      "keep going",
    );
  });

  it("passes generic harness prompts as a final argument", async () => {
    mocks.discoverAgents.mockReturnValue({
      agents: [{ ...agent, harness: "codex" }],
    });
    mocks.loadSubagentsConfig.mockReturnValue({
      maxConcurrent: 4,
      maxDepth: 1,
      defaultTimeoutMs: 30 * 60 * 1_000,
      writeLockTimeoutMs: 30_000,
      harnesses: {
        codex: {
          command: "codex",
          args: ["exec", "--prompt={prompt}"],
          input: "arg",
        },
      },
      path: "/tmp/subagents.json",
      diagnostics: [],
    });
    await createTool().execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "codex",
        args: ["exec", "--prompt=You are a scout.\n\nfind"],
        harness: "codex",
        inputMode: "text",
      }),
    );
  });

  it("resumes a generic harness with its saved harness and text input", async () => {
    mocks.discoverAgents.mockReturnValue({
      agents: [{ ...agent, harness: "claude" }],
    });
    mocks.loadSubagentsConfig.mockReturnValue({
      maxConcurrent: 4,
      maxDepth: 1,
      defaultTimeoutMs: 30 * 60 * 1_000,
      writeLockTimeoutMs: 30_000,
      harnesses: {
        claude: { command: "claude", args: ["-p"], input: "stdin" },
      },
      path: "/tmp/subagents.json",
      diagnostics: [],
    });
    mocks.attachSubagent.mockResolvedValue({
      ...running,
      status: "failed",
      harness: "claude",
      inputMode: "text",
    });
    await createTool().execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "claude",
        harness: "claude",
        inputMode: "text",
        initialInput: "You are a scout.\n\nfind",
      }),
    );
    expect(mocks.sendSubagent).not.toHaveBeenCalled();
  });

  it("resumes a failed child from a session agent definition", async () => {
    mocks.discoverAgents.mockReturnValue({ agents: [] });
    mocks.loadSubagentsConfig.mockReturnValue({
      maxConcurrent: 4,
      maxDepth: 1,
      defaultTimeoutMs: 30 * 60 * 1_000,
      writeLockTimeoutMs: 30_000,
      harnesses: {
        claude: { command: "claude", args: ["-p"], input: "stdin" },
      },
      path: "/tmp/subagents.json",
      diagnostics: [],
    });
    mocks.attachSubagent.mockResolvedValue({
      ...running,
      agent: "reviewer",
      status: "failed",
    });
    const tool = createSubagentTool({
      getSessionAgents: () => [
        {
          name: "reviewer",
          description: "Session reviewer",
          systemPrompt: "You are a session reviewer.",
          harness: "claude",
          source: "session",
        },
      ],
    });

    await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "reviewer",
        harness: "claude",
        initialInput: "You are a session reviewer.\n\nfind",
      }),
    );
  });

  it("rejects an unknown generic harness", async () => {
    mocks.discoverAgents.mockReturnValue({
      agents: [{ ...agent, harness: "missing" }],
    });
    const result = await createTool().execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(result)).toContain("unknown harness");
  });

  it("lists, reports status, sends, waits, and cancels", async () => {
    mocks.listSubagents.mockResolvedValue([running]);
    mocks.readSubagentLog.mockReturnValue("line");
    mocks.waitSubagent.mockResolvedValue({
      ...running,
      status: "completed",
    });
    const tool = createTool();
    const exec = (params: Record<string, unknown>) =>
      tool.execute("1", params, undefined, undefined, ctx as never);

    expect(detailsOf(await exec({ action: "list" })).agents).toHaveLength(1);
    expect(detailsOf(await exec({ action: "status", id: "sub-1" })).log).toBe(
      "line",
    );
    await exec({ action: "send", id: "sub-1", message: "go", mode: "steer" });
    expect(mocks.sendSubagent).toHaveBeenCalledWith(
      "/tmp/pi-subagents-tool",
      "sub-1",
      expect.objectContaining({ type: "steer", message: "go" }),
    );
    expect(
      detailsOf(await exec({ action: "wait", id: "sub-1", timeoutMs: 100 }))
        .status,
    ).toBe("completed");
    expect(
      detailsOf(await exec({ action: "cancel", id: "sub-1" })).status,
    ).toBe("completed");
    expect(mocks.abortSubagent).toHaveBeenCalled();
  });

  it("resumes a failed child with the same id and an incremented attempt", async () => {
    const failed: SubagentState = {
      ...running,
      status: "failed",
      attempt: 1,
      parentSession: "session-1",
      session: "/tmp/sub-1.session.jsonl",
    };
    mocks.attachSubagent.mockResolvedValue(failed);
    const tool = createTool();
    const result = await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub-1",
        attempt: 2,
        agent: "scout",
        task: "find",
        parentSession: "session-1",
        sessionPath: "/tmp/sub-1.session.jsonl",
      }),
    );
    expect(mocks.sendSubagent).toHaveBeenCalledWith(
      "/tmp/pi-subagents-tool",
      "sub-1",
      expect.objectContaining({ type: "prompt", message: "find" }),
    );
    expect(detailsOf(result).status).toBe("running");

    mocks.attachSubagent.mockResolvedValue(running);
    const notFailed = await createTool().execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(notFailed)).toContain("only failed");
  });

  it("reports validation errors", async () => {
    const tool = createTool();
    const missing = await tool.execute(
      "1",
      { action: "start", agent: "scout" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(missing)).toContain("agent and task");

    const unknown = await tool.execute(
      "1",
      { action: "start", agent: "nope", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(unknown)).toContain("unknown agent");

    const noId = await tool.execute(
      "1",
      { action: "status" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(noId)).toContain("requires id");
  });

  it("renders subagent call and result", async () => {
    const mockTheme = {
      fg: (_token: string, text: string) => text,
      bg: (_token: string, text: string) => text,
      bold: (text: string) => `**${text}**`,
      italic: (text: string) => text,
      underline: (text: string) => text,
      dim: (text: string) => text,
    } as never;

    mocks.listSubagents.mockResolvedValue([running]);
    mocks.readSubagentLog.mockReturnValue("line 1\nline 2");
    const tool = createTool();

    const callComp = tool.renderCall?.(
      { action: "start", agent: "scout", task: "find facts" },
      mockTheme,
      {} as never,
    );
    expect(callComp?.render(80).join("\n")).toContain("subagent");
    expect(callComp?.render(80).join("\n")).toContain("scout");

    const listRes = await tool.execute(
      "1",
      { action: "list" },
      undefined,
      undefined,
      ctx as never,
    );
    const listComp = tool.renderResult?.(
      listRes as never,
      { expanded: false, isPartial: false },
      mockTheme,
      {} as never,
    );
    expect(listComp?.render(80).join("\n")).toContain("@sub-1");

    const statusRes = await tool.execute(
      "2",
      { action: "status", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    const statusComp = tool.renderResult?.(
      statusRes as never,
      { expanded: false, isPartial: false },
      mockTheme,
      {} as never,
    );
    const rendered = statusComp?.render(80).join("\n") ?? "";
    expect(rendered).toContain("@sub-1");
    expect(rendered).toContain("line 1");
  });
});
