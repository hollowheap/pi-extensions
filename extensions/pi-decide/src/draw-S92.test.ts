import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return { registerTool: vi.fn(), on: vi.fn() };
}

describe("S92 pi-decide tool exposure", () => {
  it("registers exactly one direct decide tool", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool).toMatchObject({ name: "decide", exposure: "direct" });
  });

  it("S92 C02: the registered tool schema requires kind, input, and question", () => {
    const pi = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.parameters.required).toEqual(
      expect.arrayContaining(["kind", "input", "question"]),
    );
  });

  it("S92 C03: session_start tolerates a context without a session manager", () => {
    const pi = createMockPi();
    extension(pi as never);
    const notify = vi.fn();
    const handler = pi.on.mock.calls.find(
      (call) => call[0] === "session_start",
    );
    expect(() => handler?.[1]({}, { ui: { notify } })).not.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  it("S92 C04: adds no command, shortcut, or extra lifecycle events", () => {
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerService: vi.fn(),
      on: vi.fn(),
    };
    extension(pi as never);
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.registerShortcut).not.toHaveBeenCalled();
    expect(pi.registerService).not.toHaveBeenCalled();
    expect(pi.on.mock.calls.map((call) => call[0])).toEqual([
      "session_start",
      "session_tree",
      "agent_end",
      "session_compact",
    ]);
  });
});
