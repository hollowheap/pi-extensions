import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, { HOOK_STATS_TYPE } from "../src/index.js";

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
    appendEntry: vi.fn(),
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
  return { handlers, ctx, notify: ctx.ui.notify, pi };
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

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_HOOKS_DISCOVER_SKILL");
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

  it("does not contribute the hooks skill by default", () => {
    const { handlers } = setup();
    expect(handlers.resources_discover).toBeUndefined();
  });

  it("contributes the hooks skill to pi when PI_HOOKS_DISCOVER_SKILL is set", async () => {
    process.env.PI_HOOKS_DISCOVER_SKILL = "1";
    const { handlers } = setup();
    expect(handlers.resources_discover).toBeDefined();
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

  it("blocks and warns when pre-tool setup fails", async () => {
    const { handlers, ctx, notify } = setup();
    ctx.isProjectTrusted = () => {
      throw new Error("trust exploded");
    };

    const result = (await handlers.tool_call(
      toolCall("bash", { command: "ls" }),
      ctx,
    )) as { block: boolean; reason: string };

    expect(result.block).toBe(true);
    expect(result.reason).toContain("trust exploded");
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("pre-tool hooks failed"),
      "warning",
    );
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

  it("passes non-object tool input as a value field", async () => {
    const log = join(agentDir, "input.json");
    writeHooks({
      preTool: [
        {
          command: process.execPath,
          args: [
            "-e",
            `let d='';process.stdin.on('data',(c)=>{d+=c});process.stdin.on('end',()=>require('fs').writeFileSync(${JSON.stringify(log)},d))`,
          ],
        },
      ],
    });
    const { handlers, ctx } = setup();

    await handlers.tool_call(toolCall("bash", "raw-input"), ctx);

    expect(JSON.parse(readFileSync(log, "utf8")).input).toEqual({
      value: "raw-input",
    });
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

  it("drops a hook with a malformed condition and still runs sibling hooks", async () => {
    writeHooks({
      preTool: [
        {
          matcher: "bash",
          condition: 'matches(toolName, "[")',
          command: "true",
        },
        {
          matcher: "bash",
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify({decision:'block',reason:'sibling ran'}))",
          ],
        },
      ],
    });
    const { handlers, ctx } = setup();
    const result = (await handlers.tool_call(
      toolCall("bash", { command: "ls" }),
      ctx,
    )) as { block: boolean; reason: string } | undefined;
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("sibling ran");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("invalid syntax"),
      "warning",
    );
  });

  it("registers session_start", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith(
      "session_shutdown",
      expect.any(Function),
    );
  });

  it("runs session hooks sequentially and ignores stdout", async () => {
    const log = join(agentDir, "session.log");
    writeHooks({
      sessionStart: [
        {
          command: process.execPath,
          args: [
            "-e",
            `require('fs').appendFileSync(${JSON.stringify(log)}, 'a');process.stdout.write('ignored')`,
          ],
        },
        {
          command: process.execPath,
          args: [
            "-e",
            `require('fs').appendFileSync(${JSON.stringify(log)}, 'b')`,
          ],
        },
      ],
    });
    const { handlers, ctx, notify } = setup();
    await handlers.session_start({ type: "session_start" }, ctx);
    expect(readFileSync(log, "utf8")).toBe("ab");
    expect(notify).not.toHaveBeenCalled();
  });

  it("warns when a session hook fails and keeps going", async () => {
    const log = join(agentDir, "session.log");
    writeHooks({
      sessionStart: [
        {
          command: process.execPath,
          args: ["-e", "process.stderr.write('boom');process.exit(1)"],
        },
        {
          command: process.execPath,
          args: [
            "-e",
            `require('fs').appendFileSync(${JSON.stringify(log)}, 'ran')`,
          ],
        },
      ],
    });
    const { handlers, ctx, notify } = setup();
    await expect(
      handlers.session_start({ type: "session_start" }, ctx),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/pi-hooks: .* failed: boom/),
      "warning",
    );
    expect(readFileSync(log, "utf8")).toBe("ran");
  });

  it("does not invoke tool hooks during session_start", async () => {
    const toolLog = join(agentDir, "tool.log");
    writeHooks({
      preTool: [
        {
          matcher: "bash",
          command: process.execPath,
          args: [
            "-e",
            `require('fs').writeFileSync(${JSON.stringify(toolLog)}, 'ran')`,
          ],
        },
      ],
      sessionStart: [
        {
          command: process.execPath,
          args: ["-e", "process.stdout.write('started')"],
        },
      ],
    });
    const { handlers, ctx } = setup();
    await handlers.session_start({ type: "session_start" }, ctx);
    expect(existsSync(toolLog)).toBe(false);
  });

  it("passes the session payload on stdin", async () => {
    const log = join(agentDir, "session.json");
    writeHooks({
      sessionStart: [
        {
          command: process.execPath,
          args: [
            "-e",
            `let d='';process.stdin.on('data',(c)=>{d+=c});process.stdin.on('end',()=>require('fs').writeFileSync(${JSON.stringify(log)},d))`,
          ],
        },
      ],
    });
    const { handlers, ctx } = setup();
    await handlers.session_start({ type: "session_start" }, ctx);
    expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({
      event: "session_start",
      cwd: agentDir,
      mode: "manual",
    });
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

  it("warns and leaves the result unchanged when post-tool setup fails", async () => {
    const { handlers, ctx, notify } = setup();
    ctx.isProjectTrusted = () => {
      throw new Error("trust exploded");
    };

    await expect(
      handlers.tool_result(toolResult("bash", []), ctx),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("post-tool hooks failed"),
      "warning",
    );
  });

  it("clears chained previous output after a failed hook", async () => {
    const log = join(agentDir, "chain.json");
    writeHooks({
      postTool: [
        {
          command: process.execPath,
          args: ["-e", "process.stdout.write('first')"],
          chain: true,
        },
        {
          command: process.execPath,
          args: ["-e", "process.exit(1)"],
          chain: true,
        },
        {
          command: process.execPath,
          args: [
            "-e",
            `let d='';process.stdin.on('data',(c)=>{d+=c});process.stdin.on('end',()=>{const p=JSON.parse(d);require('fs').writeFileSync(${JSON.stringify(log)},p.input.previousOutput)})`,
          ],
          chain: true,
        },
      ],
    });
    const { handlers, ctx } = setup();

    await handlers.tool_result(toolResult("bash", []), ctx);

    expect(readFileSync(log, "utf8")).toBe("");
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

  it("persists HOOK_STATS_TYPE entry when blocks or errors increment, and on session_compact", async () => {
    writeHooks({
      preTool: [
        {
          command: "exit",
          args: ["1"],
        },
      ],
    });
    const { handlers, ctx, pi } = setup();

    await handlers.tool_call(toolCall("bash"), ctx);
    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      HOOK_STATS_TYPE,
      expect.objectContaining({
        blocks: 1,
        errors: 0,
        runs: 1,
      }),
    );

    const snap = getSessionSnapshot(ctx.sessionManager);
    expect(snap.hooks).toMatchObject({
      preToolCount: 1,
      blocks: 1,
      runs: 1,
    });

    pi.appendEntry.mockClear();
    handlers.session_compact({}, ctx);
    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      HOOK_STATS_TYPE,
      expect.objectContaining({
        runs: 1,
        blocks: 1,
      }),
    );
  });

  it("flushes passing hook stats on agent_end", async () => {
    writeHooks({ preTool: [{ command: "true" }] });
    const { handlers, ctx, pi } = setup();

    await handlers.tool_call(toolCall("bash"), ctx);
    expect(pi.appendEntry).not.toHaveBeenCalled();

    await handlers.agent_end({}, ctx);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      HOOK_STATS_TYPE,
      expect.objectContaining({ runs: 1, blocks: 0, errors: 0 }),
    );
  });

  it("surfaces a project sandbox override in status and settings", async () => {
    const { clearHooksCache } = await import("../src/settings.js");
    clearHooksCache();
    writeFileSync(
      join(agentDir, ".pi", "hooks.json"),
      JSON.stringify({ sandbox: { enabled: true }, hooks: {} }),
    );
    const { pi } = setup();
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "hooks",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const baseCtx = {
      cwd: agentDir,
      sessionManager: {},
      hasUI: true,
      mode: "tui",
      isProjectTrusted: () => true,
    };
    const statusNotify = vi.fn();
    await command.handler("status", {
      ...baseCtx,
      ui: { notify: statusNotify },
    });
    expect(statusNotify).toHaveBeenCalledWith(
      expect.stringContaining("project overlay"),
      "info",
    );

    const notify = vi.fn();
    await command.handler("settings", {
      ...baseCtx,
      ui: { notify, custom: vi.fn().mockResolvedValue(undefined) },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(".pi/hooks.json"),
      "warning",
    );
  });

  it("restores hook stats on session_start and session_tree", async () => {
    writeHooks({
      sessionStart: [{ command: "true" }],
      preTool: [],
      postTool: [],
    });
    const { handlers } = setup();
    const sessionManager = {
      getBranch: vi.fn(() => [
        {
          type: "custom",
          customType: HOOK_STATS_TYPE,
          data: {
            runs: 10,
            blocks: 3,
            errors: 2,
            updatedAt: 4000,
          },
        },
      ]),
    };
    const ctx = {
      cwd: agentDir,
      sessionManager,
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    };

    handlers.session_tree({}, ctx);
    let snap = getSessionSnapshot(sessionManager);
    expect(snap.hooks).toMatchObject({
      runs: 10,
      blocks: 3,
      errors: 2,
      sessionStartCount: 1,
    });

    await handlers.session_start({}, ctx);
    snap = getSessionSnapshot(sessionManager);
    expect(snap.hooks?.runs).toBeGreaterThanOrEqual(11);
  });

  it("registers /hooks command with settings, config alias, status, completions, and OS permission error warnings", async () => {
    const { clearHooksCache } = await import("../src/settings.js");
    clearHooksCache();
    writeHooks({
      preTool: [{ command: "true" }],
    });
    const { pi } = setup();
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "hooks",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string }> | null;
    };
    expect(command).toBeDefined();
    expect(
      (command.getArgumentCompletions?.("") ?? []).map((item) => item.value),
    ).toEqual(["settings", "config", "status"]);
    expect(
      (command.getArgumentCompletions?.("co") ?? []).map((item) => item.value),
    ).toEqual(["config"]);
    expect(command.getArgumentCompletions?.("config extra")).toBeNull();

    const statusNotify = vi.fn();
    await command.handler("status", {
      cwd: agentDir,
      sessionManager: {},
      hasUI: true,
      mode: "print",
      isProjectTrusted: () => true,
      ui: { notify: statusNotify },
    });
    expect(statusNotify).toHaveBeenCalledWith(
      expect.stringContaining("Hooks: 0 sessionStart, 1 preTool, 0 postTool"),
      "info",
    );

    let component:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => {
          handleInput(data: string): void;
          render(width: number): string[];
        },
      ) =>
        new Promise<void>((resolve) => {
          component = factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, s: string) => s, bold: (s: string) => s },
            {},
            resolve,
          );
        }),
    );
    const tuiNotify = vi.fn();
    const pending = command.handler("config", {
      cwd: agentDir,
      sessionManager: {},
      hasUI: true,
      mode: "tui",
      isProjectTrusted: () => true,
      ui: { notify: tuiNotify, custom },
    });
    await vi.waitFor(() => expect(component).toBeDefined());
    expect(component?.render(80).join("\n")).toContain("Hooks settings");
    component?.handleInput("\r");
    component?.handleInput("\x1b[B");
    component?.handleInput("\r");
    component?.handleInput("\x1b");
    await pending;

    const saved = JSON.parse(
      readFileSync(join(agentDir, "hooks.json"), "utf8"),
    ) as { sandbox?: { enabled?: boolean; offline?: boolean } };
    expect(saved.sandbox).toEqual({ enabled: true, offline: true });
    expect(tuiNotify).toHaveBeenCalledWith("Hooks settings saved", "info");

    if (process.getuid?.() !== 0) {
      clearHooksCache();
      const hooksPath = join(agentDir, "hooks.json");
      chmodSync(hooksPath, 0o000);
      try {
        const permNotify = vi.fn();
        await command.handler("settings", {
          cwd: agentDir,
          sessionManager: {},
          hasUI: true,
          mode: "print",
          isProjectTrusted: () => true,
          ui: { notify: permNotify },
        });
        expect(permNotify).toHaveBeenCalledWith(
          expect.stringContaining("OS permission denied"),
          "error",
        );
      } finally {
        chmodSync(hooksPath, 0o600);
      }
    }
  });
});
