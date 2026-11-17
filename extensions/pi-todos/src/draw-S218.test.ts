import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    events: { on: vi.fn(), emit: vi.fn() },
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  };
}

describe("S218 widget command surface", () => {
  it("registers a widget command in place of panel", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(names).toContain("widget");
    expect(names).not.toContain("panel");
  });

  it("widget command exposes per-widget toggles", () => {
    const pi = createMockPi();
    extension(pi as never);

    const call = pi.registerCommand.mock.calls.find(
      ([name]) => name === "widget",
    );
    const completion = (
      call?.[1] as
        | {
            getArgumentCompletions?: (
              prefix: string,
            ) => Array<{ value: string }> | null;
          }
        | undefined
    )?.getArgumentCompletions?.("");
    expect(completion ?? []).not.toHaveLength(0);
  });
});
