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
});
