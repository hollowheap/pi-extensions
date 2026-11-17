import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

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

describe("S31: a pre-hook blocks with a reason and never rewrites tool input", () => {
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
