import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abortSubagent: vi.fn(async () => undefined),
  attachSubagent: vi.fn(async () => ({
    id: "sub-1",
    status: "running",
    agent: "scout",
    task: "find",
    depth: 1,
    attempt: 1,
    project: "/repo",
    startedAt: 1,
  })),
  listSubagents: vi.fn(async () => []),
  readSubagentLog: vi.fn(() => ""),
  sendSubagent: vi.fn(async () => undefined),
}));

vi.mock("./runner.js", () => ({
  abortSubagent: mocks.abortSubagent,
  attachSubagent: mocks.attachSubagent,
  listSubagents: mocks.listSubagents,
  readSubagentLog: mocks.readSubagentLog,
  sendSubagent: mocks.sendSubagent,
}));

import { createSubagentsExtension } from "./index.js";

afterEach(() => {
  vi.clearAllMocks();
});

function setup() {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn() },
  };
  createSubagentsExtension({ getAgentDir: () => "/tmp/s127" })(pi as never);
  const command = pi.registerCommand.mock.calls.find(
    ([name]) => name === "subagent",
  )?.[1] as {
    handler: (args: string, ctx: unknown) => Promise<void>;
  };
  const ctx = {
    cwd: "/repo",
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn() },
  };
  return { command, ctx };
}

describe("S127 pause and steering", () => {
  it("pauses via abort and steers a running child with a message", async () => {
    const { command, ctx } = setup();
    await command.handler("pause sub-1", ctx);
    expect(mocks.abortSubagent).toHaveBeenCalledWith("/tmp/s127", "sub-1");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Paused subagent sub-1", "info");

    await command.handler("steer sub-1 change direction", ctx);
    expect(mocks.sendSubagent).toHaveBeenCalledWith("/tmp/s127", "sub-1", {
      type: "steer",
      message: "change direction",
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Steered subagent sub-1",
      "info",
    );
  });
});
