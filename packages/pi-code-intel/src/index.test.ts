import { beforeEach, describe, expect, it, vi } from "vitest";

const { disposeAll } = vi.hoisted(() => ({
  disposeAll: vi.fn(async () => {}),
}));

vi.mock("./lsp.js", () => ({
  disposeAllLspClients: disposeAll,
  getLspClient: vi.fn(),
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
  disposeAll.mockClear();
});

describe("pi-code-intel extension", () => {
  it("registers exactly one codemode tool", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("code_intel");
    expect(tool.exposure).toBe("codemode");
  });

  it("activates codemode when it is available and inactive", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);

    start(pi);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("does not duplicate codemode or add it when unavailable", () => {
    const active = createMockPi();
    active.getAllTools.mockReturnValue([{ name: "codemode" }]);
    active.getActiveTools.mockReturnValue(["codemode"]);
    extension(active as never);
    start(active);
    expect(active.setActiveTools).not.toHaveBeenCalled();

    const missing = createMockPi();
    extension(missing as never);
    start(missing);
    expect(missing.setActiveTools).not.toHaveBeenCalled();
  });

  it("disposes servers on session start and shutdown", () => {
    const pi = createMockPi();
    extension(pi as never);

    start(pi);
    expect(disposeAll).toHaveBeenCalledTimes(1);

    pi.handlers.session_shutdown({}, {});
    expect(disposeAll).toHaveBeenCalledTimes(2);
  });
});
