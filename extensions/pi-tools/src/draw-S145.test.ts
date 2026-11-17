import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "s145-tools-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  mkdirSync(join(dir, "sub", "inner"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "permissions.json"),
    JSON.stringify({ rules: ["allow read *", "allow edit *"] }),
  );
  const handlers: Record<string, (event: never, ctx: never) => unknown> = {};
  const pi = {
    on: vi.fn((event: string, fn: (event: never, ctx: never) => unknown) => {
      handlers[event] = fn;
      return () => {};
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
  extension(pi as never);
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
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  return { dir, handlers, ctx, commands };
}

describe("S145 active-cwd completion", () => {
  it("resolves completions against the effective cd override", async () => {
    const { handlers, ctx, commands } = setup();
    handlers.session_start(
      { type: "session_start", reason: "startup" } as never,
      ctx as never,
    );
    await commands.cd.handler("sub", ctx as never);

    const values = commands.cd
      .getArgumentCompletions?.("")
      .map((item: { value: string }) => item.value);
    expect(values).toEqual(["inner/"]);
  });
});
