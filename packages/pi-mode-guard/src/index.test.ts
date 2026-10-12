import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getBudgetUsed } from "./budget.js";
import extension from "./index.js";
import { getMode, getTokenCap, setTokenCap } from "./modes.js";

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
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

function setupProject(
  rulesFile: string,
  approved = true,
): {
  ctx: {
    cwd: string;
    hasUI: boolean;
    ui: {
      notify: ReturnType<typeof vi.fn>;
      confirm: ReturnType<typeof vi.fn>;
    };
  };
  call: (toolName: string, input: unknown) => Promise<unknown>;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-mode-guard-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const handler = toolCallHandler(pi);
  const ctx = {
    cwd: dir,
    hasUI: true,
    ui: { notify: vi.fn(), confirm: vi.fn(async () => approved) },
  };
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
    "deny edit *",
    "allow edit artifacts/specs/*.md",
    "allow edit artifacts/plan/*.md",
  ],
});

describe("pi-mode-guard extension", () => {
  it("registers tools, lifecycle hooks, and the cd, mode, and budget commands", () => {
    const pi = createMockPi();
    extension(pi as never);
    const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual(["fd", "rg"]);
    const events = pi.on.mock.calls.map(([event]) => event).sort();
    expect(events).toEqual([
      "before_agent_start",
      "message_end",
      "session_shutdown",
      "session_start",
      "tool_call",
      "tool_result",
    ]);
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd", "mode", "budget"]);
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
        rules: ["deny search *", "allow search src/*"],
      }),
    );
    await expect(call("find", { path: "src/sub" })).resolves.toBeUndefined();
    await expect(call("grep", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(call("fd", { path: "src/sub" })).resolves.toBeUndefined();
    await expect(call("rg", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(call("ls", { path: "src/sub" })).resolves.toBeUndefined();
    await expect(call("rg", { path: "other" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("asks for tools without matching rules and proceeds on approval", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("find", { path: "src/x.ts" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow find?", "src/x.ts");
  });

  it("denies bash without allow rules", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("bash", { command: "echo hi" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("no allow rule"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("runs allowlisted bash without asking", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({ rules: ["allow bash echo"] }),
    );
    await expect(call("bash", { command: "echo hi" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("gates powershell with the same allowlist", async () => {
    const { ctx, call } = setupProject(
      JSON.stringify({ rules: ["allow bash Get-ChildItem"] }),
    );
    await expect(
      call("powershell", { command: "Get-ChildItem ." }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    await expect(
      call("powershell", { command: "Remove-Item ./x" }),
    ).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("no allow rule"),
    });
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
    await expect(call("find", { path: "src/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("not approved"),
    });
  });

  it("blocks approval prompts without UI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mode-guard-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "permissions.json"), EXAMPLE_RULES);
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = {
      cwd: dir,
      hasUI: false,
      ui: { notify: vi.fn(), confirm: vi.fn() },
    };
    const result = await handler(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "find",
        input: { path: "src/x.ts" },
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
          { effect: "deny", tag: "read", pattern: "*" },
          { effect: "allow", tag: "read", pattern: "src/*" },
        ],
      }),
    );
    await expect(call("read", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(call("read", { path: "other/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("asks when find omits the path", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("find", {})).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow find?", ".");
  });

  it("warns and asks when the rules file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mode-guard-"));
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = {
      cwd: dir,
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
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
      expect.stringContaining("no .pi/permissions.json"),
      "warning",
    );
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", "src/x.ts");
  });

  it("warns and asks when the rules file is invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mode-guard-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "permissions.json"), "{oops");
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = {
      cwd: dir,
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
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

const CD_RULES = JSON.stringify({
  rules: [
    "allow read *",
    "allow edit *",
    "deny read secret/*",
    "deny read secret",
    "deny edit secret/*",
  ],
});

function setupCd(rulesFile: string = CD_RULES) {
  const dir = mkdtempSync(join(tmpdir(), "pi-cd-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  mkdirSync(join(dir, "sub"), { recursive: true });
  mkdirSync(join(dir, "secret"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const sessionManager = {};
  const ctx = {
    cwd: dir,
    sessionManager,
    hasUI: true,
    ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
  };
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  const cd = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  return {
    dir,
    ctx,
    cd: (args: string) => cd.cd.handler(args, ctx as never),
    hook: (toolName: string, input: Record<string, unknown>) =>
      handlers.tool_call(
        { type: "tool_call", toolCallId: "1", toolName, input } as never,
        ctx as never,
      ) as Promise<unknown>,
    restart: () => handlers.session_start(undefined as never, ctx as never),
  };
}

describe("/cd command", () => {
  it("changes to a valid directory inside the root", async () => {
    const { dir, ctx, cd, hook } = setupCd();
    await cd("sub");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(join(dir, "sub")),
    );
    const input = { path: "x.ts" };
    await expect(hook("write", input)).resolves.toBeUndefined();
    expect(input.path).toBe(join(dir, "sub", "x.ts"));
  });

  it("matches rules against the project root under override", async () => {
    const { dir, cd, hook } = setupCd(
      JSON.stringify({
        rules: ["deny edit *", "allow edit sub/*", "allow read *"],
      }),
    );
    await cd("sub");
    const input = { path: "x.ts" };
    await expect(hook("write", input)).resolves.toBeUndefined();
    expect(input.path).toBe(join(dir, "sub", "x.ts"));
  });

  it("rejects paths outside the root and keeps the old directory", async () => {
    const { dir, ctx, cd, hook } = setupCd();
    await cd("sub");
    await cd("../..");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("outside project root"),
      "error",
    );
    const input = { path: "x.ts" };
    await hook("write", input);
    expect(input.path).toBe(join(dir, "sub", "x.ts"));
  });

  it("rejects missing directories", async () => {
    const { ctx, cd, hook } = setupCd();
    await cd("nope");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("not a directory"),
      "error",
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    const input = { path: "x.ts" };
    await hook("write", input);
    expect(input.path).toBe("x.ts");
  });

  it("rejects directories denied by the rules", async () => {
    const { ctx, cd, hook } = setupCd();
    await cd("secret");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("denied by rules"),
      "error",
    );
    const input = { path: "x.ts" };
    await hook("write", input);
    expect(input.path).toBe("x.ts");
  });

  it("resets to the project root on empty input", async () => {
    const { ctx, cd, hook } = setupCd();
    await cd("sub");
    await cd("   ");
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("cwd", undefined);
    const input = { path: "x.ts" };
    await hook("write", input);
    expect(input.path).toBe("x.ts");
  });

  it("rewrites read paths without a verdict", async () => {
    const { dir, cd, hook } = setupCd();
    await cd("sub");
    const input = { path: "x.ts" };
    await expect(hook("read", input)).resolves.toBeUndefined();
    expect(input.path).toBe(join(dir, "sub", "x.ts"));
  });

  it("clears the override on session start", async () => {
    const { cd, hook, restart } = setupCd();
    await cd("sub");
    restart();
    const input = { path: "x.ts" };
    await hook("write", input);
    expect(input.path).toBe("x.ts");
  });
});

function setupMode(rulesFile: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-mode-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const sessionManager = {};
  const ctx = {
    cwd: dir,
    sessionManager,
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
    },
  };
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
    expect(getMode(ctx.sessionManager)).toBe("ask");
  });

  it("allows plan writes and denies other writes in plan mode", async () => {
    const { ctx, mode, hook } = setupMode('{"rules":[]}');
    await mode("plan");
    expect(getMode(ctx.sessionManager)).toBe("plan");
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

  it("denies plan writes again after leaving plan mode", async () => {
    const { ctx, hook, mode } = setupMode(
      JSON.stringify({ rules: ["deny edit *"] }),
    );
    await mode("plan");
    await expect(
      hook("write", { path: "artifacts/plan.md" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Allow write?",
      "artifacts/plan.md",
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

  it("runs writes and allowlisted bash silently in allow-edits", async () => {
    const { ctx, mode, hook } = setupMode(
      JSON.stringify({ rules: ["allow edit *", "allow bash cargo"] }),
    );
    await mode("allow-edits");
    await expect(hook("write", { path: "src/x.ts" })).resolves.toBeUndefined();
    await expect(
      hook("bash", { command: "cargo test" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("always asks for plan writes, even in allow-edits", async () => {
    const { ctx, mode, hook } = setupMode(
      JSON.stringify({ rules: ["allow edit *"] }),
    );
    await mode("allow-edits");
    await expect(
      hook("write", { path: "artifacts/plan.md" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Allow write?",
      "artifacts/plan.md",
    );
  });

  it("refuses autopilot with no token cap set", async () => {
    const { ctx, mode, hook } = setupMode('{"rules":[]}');
    await mode("autopilot");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("set a token cap first"),
      "error",
    );
    expect(getMode(ctx.sessionManager)).toBe("ask");
    await expect(hook("write", { path: "src/x.ts" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow write?", "src/x.ts");
  });

  it("blocks denied bash in autopilot", async () => {
    const { ctx, mode, hook } = setupMode(
      JSON.stringify({ rules: ["deny shell *"] }),
    );
    setTokenCap(ctx.sessionManager, 1000);
    await mode("autopilot");
    expect(getMode(ctx.sessionManager)).toBe("autopilot");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("autopilot on"),
      "warning",
    );
    await expect(hook("bash", { command: "rm -rf /" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });
});

function setupBudget(rulesFile: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-budget-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const sessionManager = {};
  const ctx = {
    cwd: dir,
    sessionManager,
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    abort: vi.fn(),
  };
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  return {
    dir,
    ctx,
    budget: (args: string) => commands.budget.handler(args, ctx as never),
    message: (message: unknown) =>
      handlers.message_end(
        { type: "message_end", message } as never,
        ctx as never,
      ),
    agentStart: () => handlers.before_agent_start({} as never, ctx as never),
  };
}

describe("/budget command", () => {
  it("adds input and output tokens across responses", () => {
    const { ctx, message } = setupBudget('{"rules":[]}');
    message({ role: "assistant", usage: { input: 100, output: 50 } });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(150);
    message({ role: "assistant", usage: { input: 25, output: 25 } });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(200);
    message({ role: "user", content: "hi" });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(200);
  });

  it("reports responses without usage and keeps the total", () => {
    const { ctx, message } = setupBudget('{"rules":[]}');
    message({ role: "assistant" });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(0);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("no usage"),
      "warning",
    );
  });

  it("updates the status line on every response", () => {
    const { ctx, message } = setupBudget('{"rules":[]}');
    message({ role: "assistant", usage: { input: 100, output: 0 } });
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "budget",
      expect.stringContaining("used"),
    );
  });

  it("sets a cap and prints used and remaining", async () => {
    const { ctx, budget } = setupBudget('{"rules":[]}');
    await budget("100000");
    expect(getTokenCap(ctx.sessionManager)).toBe(100000);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("100,000"),
    );
  });

  it("rejects a cap of 0 or less", async () => {
    const { ctx, budget } = setupBudget('{"rules":[]}');
    for (const arg of ["0", "-5", "1.5", "abc"]) {
      await budget(arg);
    }
    expect(getTokenCap(ctx.sessionManager)).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("greater than 0"),
      "error",
    );
  });

  it("prints used and remaining without changing the cap", async () => {
    const { ctx, budget, message } = setupBudget('{"rules":[]}');
    message({ role: "assistant", usage: { input: 1000, output: 0 } });
    await budget("");
    expect(getTokenCap(ctx.sessionManager)).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("no cap set"),
    );
  });

  it("stops the next call past the cap and resumes on raise", async () => {
    const { ctx, budget, message, agentStart } = setupBudget('{"rules":[]}');
    await budget("1000");
    agentStart();
    expect(ctx.abort).not.toHaveBeenCalled();
    message({ role: "assistant", usage: { input: 600, output: 500 } });
    agentStart();
    expect(ctx.abort).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("budget reached"),
      "error",
    );
    await budget("5000");
    agentStart();
    expect(ctx.abort).toHaveBeenCalledTimes(1);
  });
});

function setupProvider() {
  const pi = createMockPi();
  extension(pi as never);
  const sessionManager = {};
  const ctx = {
    cwd: "/tmp/pi-prov",
    sessionManager,
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    abort: vi.fn(),
  };
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
  it("publishes mode and budget values on session start", () => {
    const { pi, ctx, handlers } = setupProvider();
    handlers.session_start(undefined as never, ctx as never);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "mode-guard",
      text: "ASK",
    });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "budgets",
      text: "",
    });
  });

  it("republishes current values on statusline request", () => {
    const { pi, ctx, handlers, request } = setupProvider();
    handlers.session_start(undefined as never, ctx as never);
    const calls = pi.events.emit.mock.calls.length;
    request();
    expect(pi.events.emit.mock.calls.length).toBeGreaterThan(calls);
    expect(pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "budgets",
      text: "",
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

  it("publishes budget totals", () => {
    const { pi, ctx, handlers } = setupProvider();
    setTokenCap(ctx.sessionManager, 1000);
    handlers.message_end(
      {
        type: "message_end",
        message: { role: "assistant", usage: { input: 60, output: 40 } },
      } as never,
      ctx as never,
    );
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "budgets",
      text: "100 used, 900 remaining",
    });
  });
});
