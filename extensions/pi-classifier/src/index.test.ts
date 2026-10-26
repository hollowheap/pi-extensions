import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

import extension from "./index.js";

function createMockPi() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  return {
    on: vi.fn(
      (event: string, fn: (event: unknown, ctx: unknown) => unknown) => {
        handlers[event] = fn;
        return () => {};
      },
    ),
    registerTool: vi.fn(),
    getAllTools: vi.fn((): Array<{ name: string }> => []),
    getActiveTools: vi.fn((): string[] => []),
    setActiveTools: vi.fn(),
    handlers,
  };
}

function start(pi: ReturnType<typeof createMockPi>): void {
  pi.handlers.session_start({}, {});
}

beforeEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

function useConfig(value: unknown): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-classifier-"));
  writeFileSync(join(dir, "classifier.json"), JSON.stringify(value));
  state.agentDir = dir;
}

describe("pi-classifier extension", () => {
  it("registers one direct decide tool by default", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("decide");
    expect(tool.exposure).toBe("direct");
  });

  it("reports invalid config on session_start", () => {
    useConfig({ model: "bad" });
    const pi = createMockPi();
    extension(pi as never);
    const ctx = {
      ui: { notify: vi.fn() },
    };
    pi.handlers.session_start({}, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("pi-classifier:"),
      "warning",
    );
  });

  it("does not activate codemode", () => {
    const pi = createMockPi();
    pi.getAllTools = vi.fn(() => [{ name: "codemode" }]);
    pi.getActiveTools = vi.fn(() => ["read"]);
    pi.setActiveTools = vi.fn();
    extension(pi as never);
    start(pi);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });
});
