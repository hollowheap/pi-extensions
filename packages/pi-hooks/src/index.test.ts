import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

let agentDir = "";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => agentDir,
}));

function writeHooks(hooks: unknown): void {
  writeFileSync(join(agentDir, "hooks.json"), JSON.stringify({ hooks }));
}

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
    events: { on: vi.fn(), emit: vi.fn() },
  };
  extension(pi as never);
  const ctx = {
    cwd: agentDir,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn(), confirm: vi.fn(), setStatus: vi.fn() },
  };
  return { handlers, ctx, notify: ctx.ui.notify };
}

function toolCall(toolName: string, input: unknown = {}) {
  return {
    type: "tool_call",
    toolName,
    toolCallId: "call_1",
    input,
  };
}

function toolResult(toolName: string, content: unknown[] = []) {
  return {
    type: "tool_result",
    toolName,
    toolCallId: "call_1",
    input: {},
    content,
    isError: false,
  };
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-hooks-"));
  mkdirSync(join(agentDir, ".pi"), { recursive: true });
});

describe("pi-hooks extension", () => {
  it("registers no model-callable tool", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it("contributes the hooks skill to pi", async () => {
    const { handlers } = setup();
    const result = (await handlers.resources_discover(
      { type: "resources_discover", cwd: agentDir, reason: "startup" },
      {},
    )) as { skillPaths?: string[] };
    expect(result.skillPaths).toHaveLength(1);
    const path = result.skillPaths?.[0] ?? "";
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("name: hooks-init");
    expect(content).toContain("description:");
  });

  it("keeps the skill out of the package skills root", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    expect(existsSync(join(packageRoot, "skills"))).toBe(false);
  });

  it("blocks a call when a pre-hook refuses it", async () => {
    writeHooks({
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
    });
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_call(
      toolCall("bash", { command: "ls" }),
      ctx,
    )) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    expect(result.reason).toContain("not on main");
  });

  it("passes a call no hook refuses", async () => {
    writeHooks({
      preTool: [
        {
          matcher: "bash",
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify({decision:'allow'}))",
          ],
        },
      ],
    });
    const { handlers, ctx } = setup();
    const result = await handlers.tool_call(
      toolCall("bash", { command: "ls" }),
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("ignores hooks that do not match the tool", async () => {
    writeHooks({
      preTool: [
        {
          matcher: "edit",
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify({decision:'block',reason:'no edits'}))",
          ],
        },
      ],
    });
    const { handlers, ctx } = setup();
    const result = await handlers.tool_call(
      toolCall("bash", { command: "ls" }),
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("appends the post-hook output to the result", async () => {
    writeHooks({
      postTool: [
        {
          matcher: "edit",
          command: process.execPath,
          args: ["-e", "process.stdout.write('tests passed')"],
        },
      ],
    });
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_result(
      toolResult("edit", [{ type: "text", text: "edited" }]),
      ctx,
    )) as { content: { type: string; text: string }[] };
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe("edited");
    expect(result.content[1].text).toContain("tests passed");
    expect(result.content[1].text).toContain("pi-hooks");
  });

  it("keeps the structured content when it appends", async () => {
    writeHooks({
      postTool: [
        {
          command: process.execPath,
          args: ["-e", "process.stdout.write('note')"],
        },
      ],
    });
    const { handlers, ctx } = setup();
    const event = toolResult("bash", []);
    const result = (await handlers.tool_result(
      { ...event, structuredContent: { ok: true } },
      ctx,
    )) as { structuredContent?: unknown };
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it("reports a failing post-hook without changing the result", async () => {
    writeHooks({
      postTool: [
        {
          command: "pi-hooks-missing-binary",
          args: [],
        },
      ],
    });
    const { handlers, ctx, notify } = setup();
    const result = await handlers.tool_result(toolResult("bash", []), ctx);
    expect(result).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("command not found"),
      "warning",
    );
  });
});
