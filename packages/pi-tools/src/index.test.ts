import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "@hollowheap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_FILE_NAME } from "./config.js";
import extension from "./index.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

function writeToolsConfig(dir: string, value: unknown): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify(value));
}

function createMockPi() {
  const handlers: Record<string, (event: never, ctx: never) => unknown> = {};
  return {
    on: vi.fn((event: string, fn: (event: never, ctx: never) => unknown) => {
      handlers[event] = fn;
      return () => {};
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    getAllTools: vi.fn((): Array<{ name: string }> => []),
    getActiveTools: vi.fn((): string[] => []),
    setActiveTools: vi.fn(),
    events: {
      on: vi.fn((_channel: string, _fn: (data: unknown) => void) => () => {}),
      emit: vi.fn((_channel: string, _data: unknown) => {}),
    },
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

function startSession(
  pi: ReturnType<typeof createMockPi>,
  reason = "startup",
): void {
  pi.handlers.session_start(
    { type: "session_start", reason } as never,
    {} as never,
  );
}

describe("pi-tools extension", () => {
  it("registers fd, rg, and the cd command", () => {
    const pi = createMockPi();
    extension(pi as never);
    const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual(["fd", "rg"]);
    const tools = Object.fromEntries(
      pi.registerTool.mock.calls.map(([tool]) => [tool.name, tool]),
    );
    expect(tools.fd.exposure).toBe("direct");
    expect(tools.rg.exposure).toBe("direct");
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd"]);
  });

  it("skips hidden tools but keeps the command", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-hidden-"));
    writeToolsConfig(dir, { fd: "hidden" });
    state.agentDir = dir;
    const pi = createMockPi();
    extension(pi as never);
    const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual(["rg"]);
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd"]);
  });
});

describe("codemode activation", () => {
  it("does not activate codemode for direct tools", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read", "bash"]);
    extension(pi as never);
    startSession(pi);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("activates codemode when configured and inactive", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-codemode-"));
    writeToolsConfig(dir, { fd: "codemode" });
    state.agentDir = dir;
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read", "bash"]);
    extension(pi as never);
    startSession(pi);
    expect(pi.setActiveTools).toHaveBeenCalledWith([
      "read",
      "bash",
      "codemode",
    ]);
  });

  it("does nothing when codemode is not registered", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-codemode-"));
    writeToolsConfig(dir, { rg: "codemode" });
    state.agentDir = dir;
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "fd" }, { name: "rg" }]);
    pi.getActiveTools.mockReturnValue(["read", "bash"]);
    extension(pi as never);
    startSession(pi);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("does not duplicate an already active codemode", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-codemode-"));
    writeToolsConfig(dir, { fd: "codemode" });
    state.agentDir = dir;
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read", "codemode"]);
    extension(pi as never);
    startSession(pi);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("reactivates codemode on reload when configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tools-codemode-"));
    writeToolsConfig(dir, { fd: "codemode" });
    state.agentDir = dir;
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);
    startSession(pi, "reload");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });
});

describe("/cd command", () => {
  it("stores the directory in the core session without pi-guard", async () => {
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

  it("completes directories for cd", () => {
    const { dir, commands } = setupCd();
    const complete = commands.cd.getArgumentCompletions;
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(
        complete?.("s").map((item: { value: string }) => item.value),
      ).toEqual(["secret/", "sub/"]);
      expect(
        complete?.("").map((item: { value: string }) => item.value),
      ).toEqual([".pi/", "secret/", "sub/"]);
      expect(complete?.("/nonexistent-xyz/")).toBeNull();
    } finally {
      process.chdir(previous);
    }
  });
});
