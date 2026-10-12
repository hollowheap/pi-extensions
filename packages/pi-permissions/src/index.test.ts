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

function setupProject(rulesFile: string): {
  ctx: { cwd: string; ui: { notify: ReturnType<typeof vi.fn> } };
  call: (toolName: string, input: unknown) => unknown;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const pi = createMockPi();
  extension(pi as never);
  const handler = toolCallHandler(pi);
  const ctx = { cwd: dir, ui: { notify: vi.fn() } };
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
      ),
  };
}

const EXAMPLE_RULES = JSON.stringify({
  rules: [
    "deny write *",
    "allow write artifacts/specs/*.md",
    "allow write artifacts/plan/*.md",
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

  it("blocks src writes but allows spec and plan writes", () => {
    const { call } = setupProject(EXAMPLE_RULES);
    expect(call("write", { path: "src/x.ts" })).toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(call("write", { path: "artifacts/specs/a.md" })).toBeUndefined();
    expect(call("write", { path: "artifacts/plan/a.md" })).toBeUndefined();
  });

  it("gates edit as a write", () => {
    const { call } = setupProject(EXAMPLE_RULES);
    expect(call("edit", { path: "src/x.ts" })).toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(call("edit", { path: "artifacts/specs/a.md" })).toBeUndefined();
  });

  it("blocks escapes outside the project root", () => {
    const { call } = setupProject(EXAMPLE_RULES);
    expect(call("write", { path: "../evil.ts" })).toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("applies rules to find, grep, fd, and rg as reads", () => {
    const { call } = setupProject(EXAMPLE_RULES);
    for (const tool of ["find", "grep", "fd", "rg"]) {
      expect(call(tool, { path: "src/x.ts" })).toEqual({
        block: true,
        reason: expect.stringContaining("denied"),
      });
    }
  });

  it("allows reads covered by read rules", () => {
    const { call } = setupProject(
      JSON.stringify({
        rules: [
          { effect: "deny", verb: "read", pattern: "*" },
          { effect: "allow", verb: "read", pattern: "src/*" },
        ],
      }),
    );
    expect(call("grep", { path: "src/x.ts" })).toBeUndefined();
    expect(call("find", { path: "other/x.ts" })).toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("checks the project root when find or grep omit the path", () => {
    const { call } = setupProject(EXAMPLE_RULES);
    expect(call("find", {})).toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("never blocks bash or unlisted tools", () => {
    const { call } = setupProject(EXAMPLE_RULES);
    expect(call("bash", { command: "echo hi > /tmp/x" })).toBeUndefined();
    expect(call("read", { path: "src/x.ts" })).toBeUndefined();
  });

  it("warns and allows everything when the rules file is missing or broken", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = { cwd: dir, ui: { notify: vi.fn() } };
    const result = handler(
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
  });

  it("denies everything when the rules file is invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "permissions.json"), "{oops");
    const pi = createMockPi();
    extension(pi as never);
    const handler = toolCallHandler(pi);
    const ctx = { cwd: dir, ui: { notify: vi.fn() } };
    const result = handler(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "src/x.ts" },
      } as never,
      ctx as never,
    );
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON"),
      "warning",
    );
  });
});

const CD_RULES = JSON.stringify({
  rules: [
    "allow read *",
    "allow write *",
    "deny read secret/*",
    "deny read secret",
    "deny write secret/*",
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
    ui: { notify: vi.fn(), setStatus: vi.fn() },
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
      ),
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
    expect(hook("write", input)).toBeUndefined();
    expect(input.path).toBe(join(dir, "sub", "x.ts"));
  });

  it("matches rules against the project root under override", async () => {
    const { dir, cd, hook } = setupCd(
      JSON.stringify({
        rules: ["deny write *", "allow write sub/*", "allow read *"],
      }),
    );
    await cd("sub");
    const input = { path: "x.ts" };
    expect(hook("write", input)).toBeUndefined();
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
    hook("write", input);
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
    hook("write", input);
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
    hook("write", input);
    expect(input.path).toBe("x.ts");
  });

  it("resets to the project root on empty input", async () => {
    const { ctx, cd, hook } = setupCd();
    await cd("sub");
    await cd("   ");
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("cwd", undefined);
    const input = { path: "x.ts" };
    hook("write", input);
    expect(input.path).toBe("x.ts");
  });

  it("rewrites read paths without a verdict", async () => {
    const { dir, cd, hook } = setupCd();
    await cd("sub");
    const input = { path: "x.ts" };
    expect(hook("read", input)).toBeUndefined();
    expect(input.path).toBe(join(dir, "sub", "x.ts"));
  });

  it("clears the override on session start", async () => {
    const { cd, hook, restart } = setupCd();
    await cd("sub");
    restart();
    const input = { path: "x.ts" };
    hook("write", input);
    expect(input.path).toBe("x.ts");
  });
});
