import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

function createMockPi() {
  const handlers: Record<string, (event: never, ctx: never) => unknown> = {};
  return {
    on: vi.fn((event: string, fn: (event: never, ctx: never) => unknown) => {
      handlers[event] = fn;
      return () => {};
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    handlers,
  };
}

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
    isProjectTrusted: () => true,
    ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
  };
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  return {
    dir,
    pi,
    ctx,
    commands,
    cd: (args: string) => commands.cd.handler(args, ctx as never),
  };
}

function currentCwd(ctx: { sessionManager: unknown }): string | undefined {
  return session(ctx.sessionManager).cwd;
}

describe("pi-tools extension", () => {
  it("registers no tools and exposes the /cd command", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd"]);
  });
});

describe("/cd command", () => {
  it("updates session state and status without pi-guard", async () => {
    const { dir, ctx, cd } = setupCd();
    await cd("sub");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(join(dir, "sub")),
    );
    expect(currentCwd(ctx)).toBe(join(dir, "sub"));
  });

  it("rejects paths outside the root without announcing", async () => {
    const { ctx, cd } = setupCd();
    await cd("../..");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("outside project root"),
      "error",
    );
    expect(currentCwd(ctx)).toBeUndefined();
  });

  it("rejects missing directories without announcing", async () => {
    const { ctx, cd } = setupCd();
    await cd("nope");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("not a directory"),
      "error",
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(currentCwd(ctx)).toBeUndefined();
  });

  it("rejects directories denied by the rules without announcing", async () => {
    const { ctx, cd } = setupCd();
    await cd("secret");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("denied by rules"),
      "error",
    );
    expect(currentCwd(ctx)).toBeUndefined();
  });

  it("announces a reset to the project root on empty input", async () => {
    const { ctx, cd } = setupCd();
    await cd("sub");
    await cd("   ");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", undefined);
    expect(currentCwd(ctx)).toBeUndefined();
  });

  it("completes relative to the active cd override", async () => {
    const { dir, pi, ctx, commands, cd } = setupCd();
    mkdirSync(join(dir, "sub", "inner"), { recursive: true });
    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    await cd("sub");
    expect(
      commands.cd
        .getArgumentCompletions?.("")
        .map((item: { value: string }) => item.value),
    ).toEqual(["inner/"]);
  });

  it("completes allowed directories for cd from the session cwd", () => {
    const { pi, ctx, commands } = setupCd();
    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    const complete = commands.cd.getArgumentCompletions;
    expect(
      complete?.("s").map((item: { value: string }) => item.value),
    ).toEqual(["sub/"]);
    expect(complete?.("").map((item: { value: string }) => item.value)).toEqual(
      [".pi/", "sub/"],
    );
    expect(complete?.("/nonexistent-xyz/")).toBeNull();
  });
});
