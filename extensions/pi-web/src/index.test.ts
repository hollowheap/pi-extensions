import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";
import { rememberWebLinks } from "./tools.js";

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
  it("inserts a recent result link into the editor", async () => {
    const pi = createMockPi();
    extension(pi as never);
    rememberWebLinks([
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
    ]);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null;
    };
    const pasteToEditor = vi.fn();
    const notify = vi.fn();

    await command.handler("insert 2", {
      hasUI: true,
      mode: "tui",
      ui: { pasteToEditor, notify, custom: vi.fn() },
    });

    expect(pasteToEditor).toHaveBeenCalledWith("https://example.com/b");
    expect(notify).toHaveBeenCalledWith(
      "Inserted https://example.com/b",
      "info",
    );
    expect(
      (command.getArgumentCompletions?.("insert 2") ?? []).map(
        (item) => item.value,
      ),
    ).toEqual(["2"]);
  });

  it("activates codemode when it is registered and inactive", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("removes web_search and web_fetch from the active tool set", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue([
      "read",
      "web_search",
      "web_fetch",
      "codemode",
    ]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("removes direct web tools even when codemode is unavailable", () => {
    const pi = createMockPi();
    pi.getActiveTools.mockReturnValue(["read", "web_search"]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read"]);
  });

  it("does not duplicate an already-active codemode", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["codemode"]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("does not add codemode when it is not registered", () => {
    const pi = createMockPi();
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

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
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "web",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
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
