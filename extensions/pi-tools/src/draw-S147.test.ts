import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function setupWithHandlers() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers[event] = handler;
        return () => {};
      },
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
  extension(pi as never);
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  return { pi, handlers, commands };
}

describe("S147 no injected search tools", () => {
  it("registers no model tools at all", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };

    extension(pi as never);

    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it("S147 C02: initialization registers only the cd command", () => {
    const { pi } = setupWithHandlers();
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual(["cd"]);
    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it("S147 C03: shutdown clears the completion context", () => {
    const { handlers, commands } = setupWithHandlers();
    const ctx = {
      cwd: mkdtempSync(join(tmpdir(), "s147-complete-")),
      sessionManager: { getBranch: vi.fn(() => []) },
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    };
    handlers.session_start?.({}, ctx);
    expect(commands.cd.getArgumentCompletions?.("")).not.toBeNull();
    handlers.session_shutdown?.({});
    expect(commands.cd.getArgumentCompletions?.("")).toBeNull();
  });

  it("S147 C04: a persisted cwd is restored and published on session start", () => {
    const { handlers } = setupWithHandlers();
    const root = mkdtempSync(join(tmpdir(), "s147-cwd-"));
    mkdirSync(join(root, "sub"));
    const branch = [
      { customType: "hollowheap.core.cwd", data: { cwd: join(root, "sub") } },
    ];
    const ctx = {
      cwd: root,
      sessionManager: { getBranch: vi.fn(() => branch) },
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    };
    handlers.session_start?.({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
  });
});
