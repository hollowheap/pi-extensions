import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerToolRenderer: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
}

describe("S220 vim keybind reference registration", () => {
  it("does not register a standalone vim keybind command", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(names).not.toContain("vimkeys");
  });

  it("does not expose a separate vim keybind command surface", () => {
    const pi = createMockPi();
    extension(pi as never);

    const vimCommands = pi.registerCommand.mock.calls.filter(([, def]) =>
      /vim/i.test(
        (def as { description?: string } | undefined)?.description ?? "",
      ),
    );
    expect(vimCommands).toHaveLength(0);
  });
});
