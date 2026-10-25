import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

function useExposure(exposure: string): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-code-intel-"));
  writeFileSync(join(dir, "code-intel.json"), JSON.stringify({ exposure }));
  state.agentDir = dir;
}

describe("pi-code-intel extension", () => {
  it("registers one direct tool by default", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("code_intel");
    expect(tool.exposure).toBe("direct");
  });

  it("registers the configured codemode exposure", () => {
    useExposure("codemode");
    const pi = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0] as { exposure: string };
    expect(tool.exposure).toBe("codemode");
  });

  it("skips registration when hidden", () => {
    useExposure("hidden");
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it("does not activate codemode for the default direct exposure", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);
    start(pi);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("activates codemode when configured and inactive", () => {
    useExposure("codemode");
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);

    start(pi);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("does not duplicate an active codemode", () => {
    useExposure("codemode");
    const active = createMockPi();
    active.getAllTools.mockReturnValue([{ name: "codemode" }]);
    active.getActiveTools.mockReturnValue(["codemode"]);
    extension(active as never);
    start(active);
    expect(active.setActiveTools).not.toHaveBeenCalled();
  });

  it("does not add codemode when it is unavailable", () => {
    useExposure("codemode");
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
