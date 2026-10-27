import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import type { SubagentState } from "./state.js";
import { type SubagentToolDeps, createSubagentTool } from "./tool.js";

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

function createTool(overrides: Partial<SubagentToolDeps> = {}) {
  return createSubagentTool({
    getAgentDir: () => "/tmp/pi-subagents-tool",
    list: (() => []) as never,
    log: (() => "") as never,
    agents: (() => ({ agents: [agent] })) as never,
    childSpec: (() => ({ command: "pi", args: ["--mode", "rpc"] })) as never,
    start: (async () => running) as never,
    send: vi.fn(async () => undefined) as never,
    attach: (async () => running) as never,
    abort: vi.fn(async () => undefined) as never,
    wait: (async () => running) as never,
    ...overrides,
  });
}

const ctx = {
  cwd: "/repo",
  isProjectTrusted: () => true,
};

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_SUBAGENT_DEPTH");
});

describe("subagent tool", () => {
  it("starts a trusted agent and sends the task prompt", async () => {
    const start = vi.fn(async () => running);
    const send = vi.fn(async () => undefined);
    const tool = createTool({
      start: start as never,
      send: send as never,
    });
    const result = await tool.execute(
      "1",
      { action: "start", agent: "scout", task: "find" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "scout",
        task: "find",
        depth: 1,
        env: { PI_SUBAGENT_DEPTH: "1" },
      }),
    );
    expect(send).toHaveBeenCalledWith(
      "/tmp/pi-subagents-tool",
      "sub-1",
      expect.objectContaining({ type: "prompt", message: "find" }),
    );
    expect(detailsOf(result).status).toBe("running");
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

  it("lists, reports status, sends, waits, and cancels", async () => {
    const list = vi.fn(() => [running]);
    const log = vi.fn(() => "line");
    const send = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const wait = vi.fn(async () => ({
      ...running,
      status: "completed" as const,
    }));
    const tool = createTool({
      list: list as never,
      log: log as never,
      send: send as never,
      abort: abort as never,
      wait: wait as never,
    });
    const exec = (params: Record<string, unknown>) =>
      tool.execute("1", params, undefined, undefined, ctx as never);

    expect(detailsOf(await exec({ action: "list" })).agents).toHaveLength(1);
    expect(detailsOf(await exec({ action: "status", id: "sub-1" })).log).toBe(
      "line",
    );
    await exec({ action: "send", id: "sub-1", message: "go", mode: "steer" });
    expect(send).toHaveBeenCalledWith(
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
    expect(abort).toHaveBeenCalled();
  });

  it("resumes a failed child with the same id and an incremented attempt", async () => {
    const failed: SubagentState = {
      ...running,
      status: "failed",
      attempt: 1,
      session: "/tmp/sub-1.session.jsonl",
    };
    const start = vi.fn(async () => running);
    const send = vi.fn(async () => undefined);
    const tool = createTool({
      attach: (async () => failed) as never,
      start: start as never,
      send: send as never,
    });
    const result = await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub-1",
        attempt: 2,
        agent: "scout",
        task: "find",
        sessionPath: "/tmp/sub-1.session.jsonl",
      }),
    );
    expect(send).toHaveBeenCalledWith(
      "/tmp/pi-subagents-tool",
      "sub-1",
      expect.objectContaining({ type: "prompt", message: "find" }),
    );
    expect(detailsOf(result).status).toBe("running");

    const runningTool = createTool();
    const notFailed = await runningTool.execute(
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

    const tool = createTool({
      list: (() => [running]) as never,
      log: (() => "line 1\nline 2") as never,
    });

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
