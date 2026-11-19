import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "@hollowheap/core";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { CWD_ENTRY } from "@hollowheap/core/state";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

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
  const branch: Array<{ type: string; customType?: string; data?: unknown }> =
    [];
  const sessionManager = {
    getBranch: vi.fn(() => branch),
    appendCustomEntry: vi.fn((type: string, data: unknown) => {
      branch.push({ type: "custom", customType: type, data });
    }),
  };
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
    branch,
    commands,
    cd: (args: string) => commands.cd.handler(args, ctx as never),
  };
}

function currentCwd(ctx: { sessionManager: unknown }): string | undefined {
  return session(ctx.sessionManager).cwd;
}

describe("pi-tools extension", () => {
  it("registers codemode tools and exposes the /cd command and lifecycle hooks", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(
      pi.registerTool.mock.calls.map(([tool]) => [tool.name, tool.exposure]),
    ).toEqual([
      ["batch", "codemode"],
      ["compact_context", "codemode"],
    ]);
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_tree", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_compact", expect.any(Function));
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd"]);
  });
});

describe("/cd command", () => {
  it("updates session state and status without pi-guard, persisting and syncing snapshot", async () => {
    const { dir, ctx, branch, cd } = setupCd();
    await cd("sub");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(join(dir, "sub")),
    );
    expect(currentCwd(ctx)).toBe(join(dir, "sub"));

    expect(branch.some((e) => e.customType === CWD_ENTRY)).toBe(true);
    expect(getSessionSnapshot(ctx.sessionManager).cwd).toEqual(
      expect.objectContaining({
        root: dir,
        effective: join(dir, "sub"),
        updatedAt: expect.any(Number),
      }),
    );
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

  it("announces a reset to the project root on empty input and clears snapshot", async () => {
    const { ctx, cd } = setupCd();
    await cd("sub");
    await cd("   ");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", undefined);
    expect(currentCwd(ctx)).toBeUndefined();
    expect(getSessionSnapshot(ctx.sessionManager).cwd).toBeUndefined();
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

  it("restores valid persisted cwd on session_start and session_tree", () => {
    const { dir, pi, ctx, branch } = setupCd();
    const subDir = join(dir, "sub");
    branch.push({
      type: "custom",
      customType: CWD_ENTRY,
      data: { cwd: subDir, updatedAt: Date.now() },
    });

    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    expect(currentCwd(ctx)).toBe(subDir);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
    expect(getSessionSnapshot(ctx.sessionManager).cwd).toEqual(
      expect.objectContaining({
        root: dir,
        effective: subDir,
        updatedAt: expect.any(Number),
      }),
    );

    // session_tree restores similarly
    pi.handlers.session_tree({ type: "session_tree" } as never, ctx as never);
    expect(currentCwd(ctx)).toBe(subDir);
  });

  it("clears cwd if persisted path is invalid, missing, or denied", () => {
    const { dir, pi, ctx, branch } = setupCd();
    // Denied path
    const secretDir = join(dir, "secret");
    branch.push({
      type: "custom",
      customType: CWD_ENTRY,
      data: { cwd: secretDir, updatedAt: Date.now() },
    });

    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    expect(currentCwd(ctx)).toBeUndefined();
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", undefined);
  });

  it("tombstones a rejected persisted cwd so later restores stop re-reading it", () => {
    const { dir, pi, ctx, branch } = setupCd();
    branch.push({
      type: "custom",
      customType: CWD_ENTRY,
      data: { cwd: join(dir, "secret"), updatedAt: Date.now() },
    });

    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    expect(currentCwd(ctx)).toBeUndefined();
    const cwdEntries = branch.filter((e) => e.customType === CWD_ENTRY);
    expect(cwdEntries.at(-1)?.data).toEqual(
      expect.objectContaining({ cwd: null }),
    );

    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    expect(currentCwd(ctx)).toBeUndefined();
    expect(
      branch.filter((e) => e.customType === CWD_ENTRY).at(-1)?.data,
    ).toEqual(expect.objectContaining({ cwd: null }));
  });

  it("offers no completions until a session context is available", () => {
    const { commands } = setupCd();
    expect(commands.cd.getArgumentCompletions?.("s")).toBeNull();
  });

  it("clears the completion context on session shutdown", () => {
    const { pi, ctx, commands } = setupCd();
    pi.handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    expect(commands.cd.getArgumentCompletions?.("s")).not.toBeNull();

    pi.handlers.session_shutdown({} as never, ctx as never);
    expect(commands.cd.getArgumentCompletions?.("s")).toBeNull();
  });

  it("rejects a cwd denied for any file-tool tag, not just read", async () => {
    const rules = JSON.stringify({
      rules: [
        "allow read *",
        "allow edit *",
        "deny search secret/*",
        "deny search secret",
      ],
    });
    const { ctx, cd } = setupCd(rules);
    await cd("secret");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("denied by rules"),
      "error",
    );
    expect(currentCwd(ctx)).toBeUndefined();
  });

  it("re-persists CWD_ENTRY on session_compact when effective cwd differs from project root", () => {
    const { pi, ctx, cd, branch } = setupCd();
    void cd("sub");
    branch.length = 0;

    pi.handlers.session_compact({} as never, ctx as never);
    expect(branch.some((e) => e.customType === CWD_ENTRY)).toBe(true);
  });
});
