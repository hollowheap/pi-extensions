import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveCwd } from "@hollowheap/core/state";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

describe("pi-tools exposes only the /cd command", () => {
  it("registers the codemode utilities alongside /cd", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);

    expect(
      pi.registerTool.mock.calls.map(([tool]) => [tool.name, tool.exposure]),
    ).toEqual([
      ["batch", "codemode"],
      ["compact_context", "codemode"],
    ]);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith("cd", expect.any(Object));
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_tree", expect.any(Function));
  });

  it("changes the effective cwd through the /cd handler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-draw-"));
    const child = join(dir, "child");
    mkdirSync(child);
    const sessionManager = {};
    const ctx = {
      cwd: dir,
      sessionManager,
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    };
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    await command.handler("child", ctx);
    expect(effectiveCwd(dir, sessionManager)).toBe(child);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "child");
  });

  it("rejects a nonexistent directory without changing cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-draw-"));
    const sessionManager = {};
    const ctx = {
      cwd: dir,
      sessionManager,
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    };
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    await command.handler("missing", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not a directory"),
      "error",
    );
    expect(effectiveCwd(dir, sessionManager)).toBe(dir);
  });

  it("completes only visible directories inside the project root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-draw-"));
    mkdirSync(join(dir, "alpha"));
    writeFileSync(join(dir, "file.txt"), "x");
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    const start = pi.on.mock.calls.find(
      ([event]) => event === "session_start",
    )?.[1] as (event: unknown, ctx: unknown) => void;
    start(
      {},
      {
        cwd: dir,
        sessionManager: {},
        hasUI: false,
        isProjectTrusted: () => true,
        ui: {},
      },
    );
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      getArgumentCompletions: (prefix: string) => Array<{ value: string }>;
    };
    const values = command.getArgumentCompletions("").map((c) => c.value);
    expect(values).toContain("alpha/");
    expect(values).not.toContain("file.txt/");
  });
});
