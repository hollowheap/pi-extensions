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

describe("S32: a post-hook appends its output to the tool result", () => {
  it("keeps the original content first and adds the hook note after it", async () => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-hooks-draw-"));
    writeFileSync(
      join(agentDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          postTool: [
            {
              matcher: "edit",
              command: process.execPath,
              args: ["-e", "process.stdout.write('tests passed')"],
            },
          ],
        },
      }),
    );
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_result(
      {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c1",
        input: {},
        content: [{ type: "text", text: "edited" }],
        isError: false,
      },
      ctx,
    )) as { content: { type: string; text: string }[] };

    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe("edited");
    expect(result.content[1].text).toContain("tests passed");
  });
});
