import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => state.agentDir,
}));

import extension from "./index.js";

function setup() {
  const pi = {
    on: vi.fn(() => () => {}),
    registerCommand: vi.fn(),
    exec: vi.fn(),
    sendUserMessage: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
  };
  extension(pi as never);
  const command = pi.registerCommand.mock.calls.find(
    ([name]) => name === "statusline",
  )?.[1] as {
    handler: (args: string, ctx: unknown) => Promise<void>;
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/repo",
    sessionManager: { getBranch: () => [] },
    ui: { notify: vi.fn(), setStatus: vi.fn(), setFooter: vi.fn() },
  };
  return { pi, command, ctx };
}

describe("S131 configurable click actions", () => {
  it("runs a configured slash action when a segment is clicked", async () => {
    const { pi, command, ctx } = setup();
    await command.handler("click usage", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("/usage", {
      expandPromptTemplates: true,
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith("Running: /usage", "info");
  });
});
