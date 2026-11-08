import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { disposeAll } = vi.hoisted(() => ({
  disposeAll: vi.fn(async () => {}),
}));

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

vi.mock("./lsp.js", () => ({
  disposeAllLspClients: disposeAll,
  getLspClient: vi.fn(),
}));

import extension from "./index.js";
import { setLspLoaded } from "./tool.js";

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
  disposeAll.mockClear();
  setLspLoaded(false);
});

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

describe("pi-language-tools extension", () => {
  it("registers one codemode tool", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("lang");
    expect(tool.exposure).toBe("codemode");
  });

  it("activates codemode when it is inactive", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);

    start(pi);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("removes lang from the active tool set", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read", "lang", "codemode"]);
    extension(pi as never);

    start(pi);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("removes lang even when codemode is unavailable", () => {
    const pi = createMockPi();
    pi.getActiveTools.mockReturnValue(["read", "lang"]);
    extension(pi as never);

    start(pi);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["read"]);
  });

  it("does not duplicate an active codemode", () => {
    const active = createMockPi();
    active.getAllTools.mockReturnValue([{ name: "codemode" }]);
    active.getActiveTools.mockReturnValue(["codemode"]);
    extension(active as never);
    start(active);
    expect(active.setActiveTools).not.toHaveBeenCalled();
  });

  it("does not add codemode when it is unavailable", () => {
    const missing = createMockPi();
    extension(missing as never);
    start(missing);
    expect(missing.setActiveTools).not.toHaveBeenCalled();
  });

  it("disposes servers on session start and shutdown only when lsp was loaded", async () => {
    const pi = createMockPi();
    extension(pi as never);

    start(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(disposeAll).not.toHaveBeenCalled();

    setLspLoaded(true);
    start(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(disposeAll).toHaveBeenCalledTimes(1);

    setLspLoaded(true);
    pi.handlers.session_shutdown({}, {});
    await new Promise((r) => setTimeout(r, 10));
    expect(disposeAll).toHaveBeenCalledTimes(2);
  });
});
