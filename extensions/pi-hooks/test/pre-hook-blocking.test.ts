import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

let agentDir = "";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => agentDir,
}));

function setup() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: never, ctx: never) => unknown) => {
        handlers[event] = handler as (event: unknown, ctx: unknown) => unknown;
        return () => {};
      },
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    appendEntry: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
  extension(pi as never);
  const ctx = {
    cwd: agentDir,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn() },
  };
  return { handlers, ctx };
}

describe("a pre-hook blocks with a reason and never rewrites tool input", () => {
  it("returns only a block verdict, leaving the tool input untouched", async () => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-hooks-draw-"));
    writeFileSync(
      join(agentDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [
            {
              matcher: "bash",
              command: process.execPath,
              args: [
                "-e",
                "process.stdout.write(JSON.stringify({decision:'block',reason:'not on main'}))",
              ],
            },
          ],
        },
      }),
    );
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_call(
      {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "c1",
        input: { command: "ls" },
      },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      block: true,
      reason: expect.stringContaining("not on main"),
    });
    expect(result).not.toHaveProperty("input");
    expect(Object.keys(result).sort()).toEqual(["block", "reason"]);
  });
});

describe("additional pre-hook seams", () => {
  function writeHook(stdoutProgram: string, matcher = "bash") {
    agentDir = mkdtempSync(join(tmpdir(), "pi-hooks-draw-"));
    writeFileSync(
      join(agentDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [
            {
              matcher,
              command: process.execPath,
              args: ["-e", stdoutProgram],
            },
          ],
        },
      }),
    );
  }

  it("a hook whose matcher does not fit the tool leaves the call untouched", async () => {
    writeHook(
      "process.stdout.write(JSON.stringify({decision:'block',reason:'no'}))",
      "edit",
    );
    const { handlers, ctx } = setup();
    const result = await handlers.tool_call(
      { type: "tool_call", toolName: "bash", toolCallId: "c1", input: {} },
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("a blocking hook persists a hollowheap.hooks stats entry", async () => {
    writeHook(
      "process.stdout.write(JSON.stringify({decision:'block',reason:'halt'}))",
    );
    const piAppend = vi.fn();
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
      {};
    const pi = {
      on: vi.fn(
        (event: string, handler: (event: never, ctx: never) => unknown) => {
          handlers[event] = handler as (
            event: unknown,
            ctx: unknown,
          ) => unknown;
          return () => {};
        },
      ),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: piAppend,
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = {
      cwd: agentDir,
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    };

    await handlers.tool_call(
      { type: "tool_call", toolName: "bash", toolCallId: "c1", input: {} },
      ctx,
    );

    expect(piAppend).toHaveBeenCalledWith(
      "hollowheap.hooks",
      expect.objectContaining({ runs: 1, blocks: 1, errors: 0 }),
    );
  });

  it("a permission-flavoured block reason is surfaced as an error notification", async () => {
    writeHook(
      "process.stdout.write(JSON.stringify({decision:'block',reason:'EACCES: permission denied'}))",
    );
    const notify = vi.fn();
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
      {};
    const pi = {
      on: vi.fn(
        (event: string, handler: (event: never, ctx: never) => unknown) => {
          handlers[event] = handler as (
            event: unknown,
            ctx: unknown,
          ) => unknown;
          return () => {};
        },
      ),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = {
      cwd: agentDir,
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify },
    };

    await handlers.tool_call(
      { type: "tool_call", toolName: "bash", toolCallId: "c1", input: {} },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("permission denied"),
      "error",
    );
  });
});
