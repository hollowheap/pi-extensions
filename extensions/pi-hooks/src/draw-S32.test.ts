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

describe("additional post-hook seams", () => {
  function writePost(program: string, matcher = "edit") {
    agentDir = mkdtempSync(join(tmpdir(), "pi-hooks-draw-"));
    writeFileSync(
      join(agentDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          postTool: [
            { matcher, command: process.execPath, args: ["-e", program] },
          ],
        },
      }),
    );
  }

  it("S32 C02: a post-hook with a non-matching matcher leaves the result unchanged", async () => {
    writePost("process.stdout.write('note')", "bash");
    const { handlers, ctx } = setup();
    const result = await handlers.tool_result(
      {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c1",
        input: {},
        content: [{ type: "text", text: "edited" }],
        isError: false,
      },
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("S32 C03: a failing post-hook yields no replacement content", async () => {
    writePost("process.stderr.write('boom');process.exit(1)");
    const { handlers, ctx } = setup();
    const result = await handlers.tool_result(
      {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c1",
        input: {},
        content: [{ type: "text", text: "edited" }],
        isError: false,
      },
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("S32 C04: appended notes preserve the original structuredContent", async () => {
    writePost("process.stdout.write('note')");
    const { handlers, ctx } = setup();
    const structuredContent = { ok: true, count: 2 };
    const result = (await handlers.tool_result(
      {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c1",
        input: {},
        content: [{ type: "text", text: "edited" }],
        isError: false,
        structuredContent,
      },
      ctx,
    )) as {
      content: { type: string; text: string }[];
      structuredContent: unknown;
    };

    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toContain("note");
    expect(result.structuredContent).toEqual(structuredContent);
  });
});
