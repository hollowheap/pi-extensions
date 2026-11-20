import { describe, expect, it, vi } from "vitest";
import { createSubagentsExtension } from "../src/index.js";

const mocks = vi.hoisted(() => ({
  abortSubagent: vi.fn(async () => undefined),
}));

vi.mock("../src/runner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/runner.js")>()),
  abortSubagent: mocks.abortSubagent,
}));

function register(listSubagents = vi.fn(async () => [])) {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const pi = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] = handler;
      return () => {};
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
  createSubagentsExtension({
    getAgentDir: () => "/tmp/draw-subagents",
    listSubagents,
  })(pi as never);
  return { handlers, pi, listSubagents };
}

describe("subagent turn ownership", () => {
  it("subscribes to turn end so turn-scoped children are cancelled", () => {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {};
    const pi = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers[event] = handler;
        return () => {};
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    createSubagentsExtension({
      getAgentDir: () => "/tmp/draw-subagents",
      listSubagents: vi.fn(async () => []),
    })(pi as never);

    expect(handlers.turn_end).toBeTypeOf("function");
  });

  it("the extension registers a tool and a command", () => {
    const { pi } = register();
    expect(pi.registerTool).toHaveBeenCalled();
    expect(pi.registerCommand).toHaveBeenCalled();
  });

  it("turn end without a turn start does not scan subagents", () => {
    const { handlers, listSubagents } = register();
    expect(() =>
      handlers.turn_end?.({}, { cwd: "/tmp/draw-subagents" }),
    ).not.toThrow();
    expect(listSubagents).not.toHaveBeenCalled();
  });

  it("a turn end after a turn start scans turn-scoped children", async () => {
    const listSubagents = vi.fn(async () => []);
    const { handlers } = register(listSubagents);
    const ctx = {
      cwd: "/tmp/draw-subagents",
      sessionManager: { getSessionId: () => "parent" },
    };
    handlers.turn_start?.({}, ctx);
    handlers.turn_end?.({}, ctx);
    await vi.waitFor(() => expect(listSubagents).toHaveBeenCalled());
  });

  it("turn end leaves children of another parent session running", async () => {
    mocks.abortSubagent.mockClear();
    const cwd = "/tmp/draw-subagents";
    const child = (id: string, parentSession?: string) => ({
      id,
      ...(parentSession === undefined ? {} : { parentSession }),
      status: "running",
      project: cwd,
      startedAt: Date.now() + 1_000,
    });
    const { handlers } = register(
      vi.fn(
        async () =>
          [
            child("owner-child", "owner"),
            child("other-child", "other"),
            child("legacy-child"),
          ] as never,
      ),
    );
    const ctx = { cwd, sessionManager: { getSessionId: () => "owner" } };
    handlers.turn_start?.({}, ctx);
    handlers.turn_end?.({}, ctx);
    await vi.waitFor(() =>
      expect(mocks.abortSubagent).toHaveBeenCalledWith(cwd, "owner-child"),
    );
    expect(mocks.abortSubagent).not.toHaveBeenCalledWith(cwd, "other-child");
    expect(mocks.abortSubagent).not.toHaveBeenCalledWith(cwd, "legacy-child");
  });

  it("turn end without a session id leaves children running", async () => {
    mocks.abortSubagent.mockClear();
    const cwd = "/tmp/draw-subagents";
    const { handlers } = register(
      vi.fn(
        async () =>
          [
            {
              id: "child",
              parentSession: "owner",
              status: "running",
              project: cwd,
              startedAt: Date.now() + 1_000,
            },
          ] as never,
      ),
    );
    handlers.turn_start?.({}, { cwd });
    handlers.turn_end?.({}, { cwd });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.abortSubagent).not.toHaveBeenCalled();
  });
});
