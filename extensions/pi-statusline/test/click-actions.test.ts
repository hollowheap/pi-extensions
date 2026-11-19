import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => state.agentDir,
}));

import extension from "../src/index.js";

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

function setupWithClickAction(action: string) {
  const dir = mkdtempSync(join(tmpdir(), "click-actions-action-"));
  writeFileSync(
    join(dir, "statusline.json"),
    JSON.stringify({ clickActions: { usage: action } }),
  );
  state.agentDir = dir;
  const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = handler;
        return () => {};
      },
    ),
    registerCommand: vi.fn(),
    exec: vi.fn(),
    sendUserMessage: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
  };
  extension(pi as never);
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/repo",
    sessionManager: { getBranch: () => [] },
    ui: { notify: vi.fn(), setStatus: vi.fn(), setFooter: vi.fn() },
  };
  handlers.session_start?.({}, ctx);
  const command = pi.registerCommand.mock.calls.find(
    ([name]) => name === "statusline",
  )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };
  return { pi, command, ctx };
}

function restoreAgentDir() {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
}

describe("configurable click actions", () => {
  it("runs a configured slash action when a segment is clicked", async () => {
    const { pi, command, ctx } = setup();
    await command.handler("click usage", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("/usage", {
      expandPromptTemplates: true,
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith("Running: /usage", "info");
  });

  it("clicking with no segment reports usage without sending", async () => {
    const { pi, command, ctx } = setup();
    await command.handler("click", ctx);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /statusline click <segment> | /statusline settings",
      "info",
    );
  });

  it("a failing external click action reports the error", async () => {
    try {
      const { pi, command, ctx } = setupWithClickAction("fake-ls --flag");
      pi.exec.mockResolvedValueOnce({
        stdout: "",
        stderr: "boom",
        code: 3,
      });
      await command.handler("click usage", ctx);
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith("boom", "error");
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "pi-statusline: action exited with code 3",
        "error",
      );
    } finally {
      restoreAgentDir();
    }
  });

  it("a configured click action overrides the default", async () => {
    try {
      const { pi, command, ctx } = setupWithClickAction("/custom");
      await command.handler("click usage", ctx);
      expect(pi.sendUserMessage).toHaveBeenCalledWith("/custom", {
        expandPromptTemplates: true,
      });
      expect(pi.sendUserMessage).not.toHaveBeenCalledWith(
        "/usage",
        expect.anything(),
      );
    } finally {
      restoreAgentDir();
    }
  });
});
