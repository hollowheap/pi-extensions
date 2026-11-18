import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "s148-cd-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "permissions.json"),
    JSON.stringify({ rules: ["allow read *", "allow edit *"] }),
  );
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers[event] = handler;
        return () => {};
      },
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
  extension(pi as never);
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const branch: unknown[] = [];
  const ctx = {
    cwd: dir,
    sessionManager: {
      getBranch: vi.fn(() => branch),
      appendCustomEntry: vi.fn(),
    },
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn() },
  };
  return { dir, handlers, ctx, commands };
}

describe("S148 /cd-only exposure", () => {
  it("registers only the /cd command and keeps its containment guard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s148-tools-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "permissions.json"),
      JSON.stringify({ rules: ["allow read *", "allow edit *"] }),
    );
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
      {};
    const pi = {
      on: vi.fn(
        (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
          handlers[event] = handler;
          return () => {};
        },
      ),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    const commands = Object.fromEntries(
      pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
    );
    const branch: unknown[] = [];
    const ctx = {
      cwd: dir,
      sessionManager: {
        getBranch: vi.fn(() => branch),
        appendCustomEntry: vi.fn(),
      },
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn() },
    };

    expect(Object.keys(commands)).toEqual(["cd"]);
    await commands.cd.handler("/etc", ctx as never);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("outside project root"),
      "error",
    );
  });

  it("S148 C02: an empty cd resets the effective directory to the root", async () => {
    const { dir, handlers, ctx, commands } = setup();
    handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    mkdirSync(join(dir, "sub"));
    await commands.cd.handler("sub", ctx as never);
    await commands.cd.handler("", ctx as never);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      `pi-tools: working directory ${dir}`,
    );
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("cwd", undefined);
  });

  it("S148 C03: cd to a missing path is refused without changing cwd", async () => {
    const { handlers, ctx, commands } = setup();
    handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    await commands.cd.handler("ghost", ctx as never);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-tools: not a directory: ghost",
      "error",
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalledWith("cwd", "ghost");
  });

  it("S148 C04: a valid cd publishes the effective cwd snapshot", async () => {
    const { dir, handlers, ctx, commands } = setup();
    handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    mkdirSync(join(dir, "sub"));
    await commands.cd.handler("sub", ctx as never);
    const snapshot = getSessionSnapshot(ctx.sessionManager);
    expect(snapshot.cwd).toMatchObject({
      root: dir,
      effective: join(dir, "sub"),
    });
  });
});
