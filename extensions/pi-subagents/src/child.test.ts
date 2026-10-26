import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChildLockExtension } from "../child.js";

const dirs: string[] = [];

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-child-"));
  dirs.push(dir);
  return dir;
}

function lockPath(dir: string): string {
  return join(dir, "subagents", "write.lock");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setup() {
  const dir = agentDir();
  const handlers: Record<string, (...args: never[]) => unknown> = {};
  const pi = {
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers[event] = handler;
      return () => {};
    }),
  };
  createChildLockExtension({ agentDir: () => dir, holdTimeoutMs: 100 })(
    pi as never,
  );
  return { dir, handlers };
}

describe("child write lock", () => {
  it("locks write/edit/bash and releases on tool result", async () => {
    const { dir, handlers } = setup();
    await handlers.tool_call(
      { toolName: "write", toolCallId: "call-1" } as never,
      {} as never,
    );
    expect(existsSync(lockPath(dir))).toBe(true);
    handlers.tool_result({ toolCallId: "call-1" } as never);
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it("ignores read-only tools", async () => {
    const { dir, handlers } = setup();
    await handlers.tool_call(
      { toolName: "read", toolCallId: "call-1" } as never,
      {} as never,
    );
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it("releases all held locks on shutdown", async () => {
    const { dir, handlers } = setup();
    await handlers.tool_call(
      { toolName: "bash", toolCallId: "call-1" } as never,
      {} as never,
    );
    expect(existsSync(lockPath(dir))).toBe(true);
    handlers.session_shutdown({} as never, {} as never);
    expect(existsSync(lockPath(dir))).toBe(false);
  });
});
