import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

describe("S75: pi-web registers exactly web_search and web_fetch", () => {
  it("registers two tools with the expected names and input schemas", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
      getAllTools: vi.fn(() => []),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(2);
    const names = pi.registerTool.mock.calls.map(
      ([tool]) => (tool as { name: string }).name,
    );
    expect(names).toEqual(["web_search", "web_fetch"]);
    const [search, fetch] = pi.registerTool.mock.calls.map(
      ([tool]) =>
        tool as { parameters: { properties?: Record<string, unknown> } },
    );
    expect(search.parameters.properties).toHaveProperty("query");
    expect(fetch.parameters.properties).toHaveProperty("url");
  });

  it("S75 C02: registers the web command and session lifecycle hooks", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
      getAllTools: vi.fn(() => []),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };
    extension(pi as never);
    expect(pi.registerCommand).toHaveBeenCalledWith("web", expect.any(Object));
    const events = (pi.on.mock.calls as unknown[][]).map(([event]) => event);
    expect(events).toContain("session_start");
    expect(events).toContain("session_tree");
    expect(events).toContain("session_compact");
  });

  it("S75 C03: activates codemode and drops web tools on session start", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
      getAllTools: vi.fn(() => [{ name: "codemode" }]),
      getActiveTools: vi.fn(() => ["web_search", "web_fetch"]),
      setActiveTools: vi.fn(),
    };
    extension(pi as never);
    const start = (pi.on.mock.calls as unknown[][]).find(
      ([event]) => event === "session_start",
    )?.[1] as (event: unknown, ctx: unknown) => void;
    start(
      {},
      {
        sessionManager: { getBranch: () => [], appendEntry: vi.fn() },
        hasUI: false,
      },
    );
    expect(pi.setActiveTools).toHaveBeenCalledWith(["codemode"]);
  });

  it("S75 C04: reports unknown /web subcommands without throwing", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
      getAllTools: vi.fn(() => []),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };
    extension(pi as never);
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "web",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const notify = vi.fn();
    await command.handler("bogus", {
      hasUI: true,
      mode: "tui",
      ui: { notify },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
      "info",
    );
  });
});
