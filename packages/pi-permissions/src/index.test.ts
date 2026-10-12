import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
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
  const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
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

describe("pi-permissions extension", () => {
  it("registers tools, lifecycle hooks, and the cd command", () => {
    const pi = createMockPi();
    extension(pi as never);
    const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual(["fd", "rg"]);
    const events = pi.on.mock.calls.map(([event]) => event).sort();
    expect(events).toEqual(["session_shutdown", "session_start", "tool_call"]);
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd"]);
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

  it("asks for bash commands", async () => {
    const { ctx, call } = setupProject(EXAMPLE_RULES);
    await expect(call("bash", { command: "echo hi" })).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow bash?", "echo hi");
  });

  it("blocks when approval is declined", async () => {
    const { call } = setupProject(EXAMPLE_RULES, false);
    await expect(call("find", { path: "src/x.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("not approved"),
    });
  });

  it("blocks approval prompts without UI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
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
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
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
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
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
