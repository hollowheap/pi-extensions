import { describe, expect, it, vi } from "vitest";
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
    registerCommand: vi.fn(),
    getAllTools: vi.fn((): Array<{ name: string }> => []),
    getActiveTools: vi.fn((): string[] => []),
    setActiveTools: vi.fn(),
    handlers,
  };
}

describe("pi-web extension", () => {
  it("registers exactly two codemode tools", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(2);
    const names = pi.registerTool.mock.calls.map(
      ([tool]) => (tool as { name: string }).name,
    );
    expect(names).toEqual(["web_search", "web_fetch"]);
    for (const [tool] of pi.registerTool.mock.calls) {
      expect((tool as { exposure: string }).exposure).toBe("codemode");
    }
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
    expect(pi.setActiveTools).not.toHaveBeenCalled();

    const search = pi.registerTool.mock.calls[0][0] as {
      parameters: { properties?: Record<string, unknown> };
    };
    const fetch = pi.registerTool.mock.calls[1][0] as {
      parameters: { properties?: Record<string, unknown> };
    };
    expect(search.parameters.properties).toHaveProperty("query");
    expect(fetch.parameters.properties).toHaveProperty("url");
  });
});
