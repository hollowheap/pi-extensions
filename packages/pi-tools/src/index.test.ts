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
    registerShortcut: vi.fn(),
    events: {
      on: vi.fn((_channel: string, _fn: (data: unknown) => void) => () => {}),
      emit: vi.fn((_channel: string, _data: unknown) => {}),
    },
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

function cwdSets(
  pi: ReturnType<typeof createMockPi>,
): { owner: unknown; dir: string | undefined }[] {
  return pi.events.emit.mock.calls
    .filter(([channel]) => channel === "guard:cwd-set")
    .map(
      ([_channel, data]) => data as { owner: unknown; dir: string | undefined },
    );
}

describe("pi-tools extension", () => {
  it("registers fd, rg, and the cd command", () => {
    const pi = createMockPi();
    extension(pi as never);
    const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual(["fd", "rg"]);
    expect(pi.on).not.toHaveBeenCalled();
    const commands = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["cd"]);
  });
});

describe("/cd command", () => {
  it("announces a valid directory inside the root", async () => {
    const { dir, pi, ctx, cd } = setupCd();
    await cd("sub");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(join(dir, "sub")),
    );
    expect(cwdSets(pi)).toEqual([
      { owner: ctx.sessionManager, dir: join(dir, "sub") },
    ]);
  });

  it("rejects paths outside the root without announcing", async () => {
    const { pi, ctx, cd } = setupCd();
    await cd("../..");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("outside project root"),
      "error",
    );
    expect(cwdSets(pi)).toEqual([]);
  });

  it("rejects missing directories without announcing", async () => {
    const { pi, ctx, cd } = setupCd();
    await cd("nope");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("not a directory"),
      "error",
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(cwdSets(pi)).toEqual([]);
  });

  it("rejects directories denied by the rules without announcing", async () => {
    const { pi, ctx, cd } = setupCd();
    await cd("secret");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("denied by rules"),
      "error",
    );
    expect(cwdSets(pi)).toEqual([]);
  });

  it("announces a reset to the project root on empty input", async () => {
    const { pi, ctx, cd } = setupCd();
    await cd("sub");
    await cd("   ");
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("cwd", undefined);
    expect(cwdSets(pi)).toEqual([
      { owner: ctx.sessionManager, dir: expect.stringContaining("sub") },
      { owner: ctx.sessionManager, dir: undefined },
    ]);
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
