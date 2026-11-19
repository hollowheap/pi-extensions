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

describe("a failing pre-hook blocks the call with the failure as reason", () => {
  it("blocks and reports the hook's stderr when the command fails", async () => {
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
                "process.stderr.write('hook exploded');process.exit(1)",
              ],
            },
          ],
        },
      }),
    );
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_call(
      { type: "tool_call", toolName: "bash", toolCallId: "c1", input: {} },
      ctx,
    )) as { block: boolean; reason: string };

    expect(result.block).toBe(true);
    expect(result.reason).toContain("hook exploded");
  });
});

describe("pre-hook decision and stats seams", () => {
  function writePre(program: string) {
    agentDir = mkdtempSync(join(tmpdir(), "pi-hooks-draw-"));
    writeFileSync(
      join(agentDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [
            {
              matcher: "bash",
              command: process.execPath,
              args: ["-e", program],
            },
          ],
        },
      }),
    );
  }

  it("non-JSON stdout is treated as a block with a decision reason", async () => {
    writePre("process.stdout.write('not json')");
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_call(
      { type: "tool_call", toolName: "bash", toolCallId: "c1", input: {} },
      ctx,
    )) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    expect(result.reason).toContain("not a decision");
  });

  it("an explicit allow decision lets the call through", async () => {
    writePre("process.stdout.write(JSON.stringify({decision:'allow'}))");
    const { handlers, ctx } = setup();
    const result = await handlers.tool_call(
      { type: "tool_call", toolName: "bash", toolCallId: "c1", input: {} },
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("a failing pre-hook records a block in the persisted hook stats", async () => {
    writePre("process.stderr.write('explode');process.exit(1)");
    const appendEntry = vi.fn();
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
      appendEntry,
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

    expect(appendEntry).toHaveBeenCalledWith(
      "hollowheap.hooks",
      expect.objectContaining({ runs: 1, blocks: 1, errors: 0 }),
    );
  });
});
