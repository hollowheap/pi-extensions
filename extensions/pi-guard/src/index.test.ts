import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session, setCwd } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: {
      on: vi.fn((_channel: string, _fn: (data: unknown) => void) => () => {}),
      emit: vi.fn((_channel: string, _data: unknown) => {}),
    },
  };
}

type Handler = (event: never, ctx: never) => unknown;

function toolCallHandler(pi: ReturnType<typeof createMockPi>): Handler {
  const calls = pi.on.mock.calls.filter(([event]) => event === "tool_call");
  expect(calls).toHaveLength(1);
  return calls[0][1] as Handler;
}

function createContext(cwd: string, approved = true) {
  return {
    cwd,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn(), confirm: vi.fn(async () => approved) },
  };
}

function setupProject(
  rulesFile: string,
  approved = true,
): {
  ctx: ReturnType<typeof createContext>;
  call: (toolName: string, input: unknown) => Promise<unknown>;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-guard-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const handler = toolCallHandler(pi);
  const ctx = createContext(dir, approved);
  return {
    ctx,
    call: (toolName: string, input: unknown) =>
      handler(
        {
          type: "tool_call",
          toolCallId: "1",
          toolName,
          input,
        } as never,
        ctx as never,
      ) as Promise<unknown>,
  };
}

const EXAMPLE_RULES = JSON.stringify({
  rules: [
    "deny edit src/*",
    "allow edit artifacts/specs/*.md",
    "allow edit artifacts/plan/*.md",
  ],
});

describe("pi-guard extension", () => {
  it("registers lifecycle hooks and the mode command", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    const events = pi.on.mock.calls.map(([event]) => event).sort();
    expect(events).toEqual([
      "session_shutdown",
      "session_start",
      "tool_call",
      "tool_result",
    ]);
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["mode"]);
    expect(pi.registerShortcut).toHaveBeenCalledWith(
      "alt+m",
      expect.objectContaining({ description: "Cycle plan/approval mode" }),
    );
  });

  it("blocks src writes but allows spec and plan writes", async () => {
    const { call } = setupProject(EXAMPLE_RULES);
    await expect(call("write", { path: "src/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    await expect(
      call("write", { path: "artifacts/specs/a.md" }),
    ).resolves.toBeUndefined();
    await expect(
      call("write", { path: "artifacts/plan/a.md" }),
    ).resolves.toBeUndefined();
  });

  it("gates edit as an edit", async () => {
    const { call } = setupProject(EXAMPLE_RULES);
    await expect(call("edit", { path: "src/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    await expect(
      call("edit", { path: "artifacts/specs/a.md" }),
    ).resolves.toBeUndefined();
  });

  it("blocks escapes outside the project root", async () => {
    const { call } = setupProject(EXAMPLE_RULES);
    await expect(call("write", { path: "../evil.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("checks find, grep, fd, rg, and ls as search", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({
        rules: ["deny search secret/*", "allow search src/*"],
      }),
    );
    await expect(call("find", { path: "src/sub" })).resolves.toBeUndefined();
    await expect(call("grep", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(call("fd", { path: "src/sub" })).resolves.toBeUndefined();
    await expect(call("rg", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(call("ls", { path: "src/sub" })).resolves.toBeUndefined();
    await expect(call("rg", { path: "secret/x" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("allows search without matching rules", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("find", { path: "src/x.ts" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("asks for unknown tools", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(
      call("mcp__docs", { path: "src/x.ts" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow mcp__docs?", "src/x.ts");
  });

  it("uses configured tags for unknown tools", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({
        tools: { mcp__docs__search: "search" },
        rules: ["allow search *"],
      }),
    );
    await expect(
      call("mcp__docs__search", { path: "." }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("does not let configured tags override built-in tools", async () => {
    const { call } = setupProject(
      JSON.stringify({
        tools: { read: "search" },
        rules: ["deny read *", "allow search *"],
      }),
      false,
    );
    await expect(call("read", { path: "x" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("tags web_search as search", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({
        rules: ["deny search secret/*", "allow search *"],
      }),
    );
    await expect(
      call("web_search", { path: "src/x" }),
    ).resolves.toBeUndefined();
    await expect(call("web_search", { path: "secret/x" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("tags web_fetch as read", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({
        rules: [
          { effect: "deny", tag: "read", pattern: "secret/*" },
          { effect: "allow", tag: "read", pattern: "src/*" },
        ],
      }),
    );
    await expect(
      call("web_fetch", { path: "src/x.ts" }),
    ).resolves.toBeUndefined();
    await expect(call("web_fetch", { path: "secret/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("does not let configured tags override web tool built-ins", async () => {
    const { call } = setupProject(
      JSON.stringify({
        tools: { web_search: "read", web_fetch: "search" },
        rules: ["deny read *", "allow search *"],
      }),
      false,
    );
    await expect(call("web_search", { path: "x" })).resolves.toBeUndefined();
    await expect(call("web_fetch", { path: "x" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("asks for bash without allow rules", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("bash", { command: "echo hi" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow bash?", "echo hi");
  });

  it("runs allowlisted bash without asking", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({ rules: ["allow shell echo"] }),
    );
    await expect(call("bash", { command: "echo hi" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("gates powershell with the same allowlist", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({ rules: ["allow shell Get-ChildItem"] }),
    );
    await expect(
      call("powershell", { command: "Get-ChildItem ." }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    await expect(
      call("powershell", { command: "Remove-Item ./x" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Allow powershell?",
      "Remove-Item ./x",
    );
  });

  it("gates task start as shell and allows list/status/wait/cancel without asking", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({
        rules: ["allow shell npm", "deny shell rm"],
      }),
    );
    await expect(call("task", { action: "list" })).resolves.toBeUndefined();
    await expect(
      call("task", { action: "status", id: "task-1" }),
    ).resolves.toBeUndefined();
    await expect(
      call("task", { action: "wait", id: "task-1" }),
    ).resolves.toBeUndefined();
    await expect(
      call("task", { action: "cancel", id: "task-1" }),
    ).resolves.toBeUndefined();
    await expect(
      call("task", { action: "start", command: "npm test" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();

    await expect(
      call("task", { action: "start", command: "rm -rf build" }),
    ).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });

    await expect(
      call("task", { action: "start", command: "cargo build" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow task?", "cargo build");
  });

  it("cuts bash output over 4000 characters", () => {
    const pi = createMockPi();
    extension(pi as never);
    const entry = pi.on.mock.calls.find(([event]) => event === "tool_result");
    if (entry === undefined) throw new Error("missing tool_result hook");
    const handler = entry[1];
    const text = `${"x".repeat(2500)}${"y".repeat(2500)}`;
    const result = handler(
      {
        type: "tool_result",
        toolCallId: "1",
        toolName: "bash",
        input: {},
        content: [{ type: "text", text }],
        isError: false,
      } as never,
      {} as never,
    ) as { content: [{ text: string }] };
    expect(result.content[0].text).toContain("cut 1000 characters");
    expect(result.content[0].text.startsWith("x".repeat(100))).toBe(true);
    expect(result.content[0].text.endsWith("y".repeat(100))).toBe(true);
    expect(result.content[0].text.length).toBeLessThan(5000);
  });

  it("leaves short bash output and other tools alone", () => {
    const pi = createMockPi();
    extension(pi as never);
    const entry = pi.on.mock.calls.find(([event]) => event === "tool_result");
    if (entry === undefined) throw new Error("missing tool_result hook");
    const handler = entry[1];
    expect(
      handler(
        {
          type: "tool_result",
          toolCallId: "1",
          toolName: "bash",
          input: {},
          content: [{ type: "text", text: "ok" }],
          isError: false,
        } as never,
        {} as never,
      ),
    ).toBeUndefined();
    expect(
      handler(
        {
          type: "tool_result",
          toolCallId: "1",
          toolName: "write",
          input: {},
          content: [{ type: "text", text: "x".repeat(5000) }],
          isError: false,
        } as never,
        {} as never,
      ),
    ).toBeUndefined();
  });

  it("blocks when approval is declined", async () => {
    const { call } = setupProject(EXAMPLE_RULES, false);
    await expect(call("write", { path: "docs/a.md" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("not approved"),
    });
  });

  it("blocks approval prompts without UI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-guard-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "permissions.json"), EXAMPLE_RULES);
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = {
      cwd: dir,
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn() },
    };
    const result = await handler(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "docs/a.md" },
      } as never,
      ctx as never,
    );
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("needs approval"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("allows reads covered by read rules", async () => {
    const { call } = setupProject(
      JSON.stringify({
        rules: [
          { effect: "deny", tag: "read", pattern: "secret/*" },
          { effect: "allow", tag: "read", pattern: "src/*" },
        ],
      }),
    );
    await expect(call("read", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(call("read", { path: "secret/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("asks when a write omits the path", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("write", {})).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", ".");
  });

  it("asks when the rules file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-guard-"));
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = createContext(dir);
    const result = await handler(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "src/x.ts" },
      } as never,
      ctx as never,
    );
    expect(result).toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", "src/x.ts");
  });

  it("warns and asks when the rules file is invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-guard-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "permissions.json"), "{oops");
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = createContext(dir);
    const result = await handler(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "src/x.ts" },
      } as never,
      ctx as never,
    );
    expect(result).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON"),
      "warning",
    );
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", "src/x.ts");
  });
});

describe("cwd override", () => {
  it("rewrites relative paths under the core override", async () => {
    const { ctx, hook } = setupMode(
      JSON.stringify({ rules: ["allow edit *"] }),
    );
    setCwd(ctx.sessionManager, join(ctx.cwd, "sub"));
    const input = { path: "x.ts" };
    await expect(hook("write", input)).resolves.toBeUndefined();
    expect(input.path).toBe(join(ctx.cwd, "sub", "x.ts"));
  });
});

function setupMode(rulesFile: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-mode-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const ctx = createContext(dir);
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  return {
    dir,
    ctx,
    mode: (args: string) => commands.mode.handler(args, ctx as never),
    hook: (toolName: string, input: Record<string, unknown>) =>
      handlers.tool_call(
        { type: "tool_call", toolCallId: "1", toolName, input } as never,
        ctx as never,
      ) as Promise<unknown>,
  };
}

describe("/mode command", () => {
  it("rejects unknown modes", async () => {
    const { ctx, mode } = setupMode('{"rules":[]}');
    await mode("turbo");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("unknown mode"),
      "error",
    );
    expect(session(ctx.sessionManager).mode).toBe("ask");
  });

  it("allows plan writes and denies other writes in plan mode", async () => {
    const { ctx, mode, hook } = setupMode('{"rules":[]}');
    await mode("plan");
    expect(session(ctx.sessionManager).mode).toBe("plan");
    await expect(
      hook("write", { path: "artifacts/plan.md" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Allow write?",
      "artifacts/plan.md",
    );
    await expect(hook("write", { path: "src/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("keeps explicit deny rules ahead of plan-path overrides", async () => {
    const { hook, mode } = setupMode(
      JSON.stringify({ rules: ["deny edit *"] }),
    );
    await mode("plan");
    await expect(hook("write", { path: "artifacts/plan.md" })).resolves.toEqual(
      {
        block: true,
        reason: expect.stringContaining("denied"),
      },
    );
    await mode("ask");
    await expect(hook("write", { path: "artifacts/plan.md" })).resolves.toEqual(
      {
        block: true,
        reason: expect.stringContaining("denied"),
      },
    );
  });

  it("waits for approval before writes in ask", async () => {
    const { ctx, hook } = setupMode('{"rules":[]}');
    await expect(hook("write", { path: "src/x.ts" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", "src/x.ts");
  });

  it("runs writes and allowlisted bash silently in edit", async () => {
    const { ctx, mode, hook } = setupMode(
      JSON.stringify({ rules: ["allow edit *", "allow shell cargo"] }),
    );
    await mode("edit");
    await expect(hook("write", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(
      hook("bash", { command: "cargo test" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("allows plan writes in edit mode", async () => {
    const { ctx, mode, hook } = setupMode(
      JSON.stringify({ rules: ["allow edit *"] }),
    );
    await mode("edit");
    await expect(
      hook("write", { path: "artifacts/plan.md" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("rejects autopilot when pi-autopilot is not installed", async () => {
    const { ctx, mode, hook } = setupMode('{"rules":[]}');
    await mode("autopilot");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("unknown mode"),
      "error",
    );
    expect(session(ctx.sessionManager).mode).toBe("ask");
    await expect(hook("write", { path: "src/x.ts" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", "src/x.ts");
  });
});

function setupProvider() {
  const pi = createMockPi();
  extension(pi as never);
  const ctx = createContext("/tmp/pi-prov");
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const requestEntry = pi.events.on.mock.calls.find(
    ([channel]) => channel === "statusline:request",
  );
  expect(requestEntry).toBeDefined();
  if (requestEntry === undefined) {
    throw new Error("missing statusline:request subscription");
  }
  return {
    pi,
    ctx,
    handlers,
    commands,
    request: requestEntry[1] as () => void,
  };
}

describe("statusline values", () => {
  it("publishes the mode value on session start", () => {
    const { pi, ctx, handlers } = setupProvider();
    handlers.session_start(undefined as never, ctx as never);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "mode-guard",
      text: "ASK",
    });
    expect(pi.events.emit).not.toHaveBeenCalledWith(
      "statusline:values",
      expect.objectContaining({ name: "budgets" }),
    );
  });

  it("republishes current values on statusline request", () => {
    const { pi, ctx, handlers, request } = setupProvider();
    handlers.session_start(undefined as never, ctx as never);
    const calls = pi.events.emit.mock.calls.length;
    request();
    expect(pi.events.emit.mock.calls.length).toBeGreaterThan(calls);
    expect(pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "mode-guard",
      text: "ASK",
    });
  });

  it("publishes the new mode after a switch", async () => {
    const { pi, ctx, commands } = setupProvider();
    await commands.mode.handler("plan", ctx as never);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "mode-guard",
      text: "PLAN",
    });
  });
});

function setupKeys(rulesFile: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-keys-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const ctx = createContext(dir);
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const shortcut = pi.registerShortcut.mock.calls[0][1].handler;
  return {
    ctx,
    commands,
    shortcut: (context: unknown) => shortcut(context as never),
  };
}

describe("mode shortcut and completions", () => {
  it("cycles ask, edit, plan in order", async () => {
    const { ctx, shortcut } = setupKeys('{"rules":[]}');
    await shortcut(ctx);
    expect(session(ctx.sessionManager).mode).toBe("edit");
    await shortcut(ctx);
    expect(session(ctx.sessionManager).mode).toBe("plan");
    await shortcut(ctx);
    expect(session(ctx.sessionManager).mode).toBe("ask");
  });

  it("completes mode names", () => {
    const { commands } = setupKeys('{"rules":[]}');
    const complete = commands.mode.getArgumentCompletions;
    expect(complete?.("").map((item: { value: string }) => item.value)).toEqual(
      ["ask", "edit", "plan"],
    );
    expect(
      complete?.("e").map((item: { value: string }) => item.value),
    ).toEqual(["edit"]);
    expect(complete?.("x")).toEqual([]);
  });
});
