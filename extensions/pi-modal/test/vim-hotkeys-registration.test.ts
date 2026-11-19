import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { formatVimKeys } from "../src/vimkeys.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerToolRenderer: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
}

describe("vim keybind reference registration", () => {
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

  it("no other keybind command surface is registered", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    for (const legacy of ["keys", "keybinds", "binds", "vim"]) {
      expect(names).not.toContain(legacy);
    }
  });

  it("the bind reference has a single shortcut registry", () => {
    const pi = createMockPi();
    extension(pi as never);

    const shortcuts = pi.registerShortcut.mock.calls.map(([name]) => name);
    expect(shortcuts).toEqual(["ctrl+shift+k"]);
  });

  it("the reference is rendered from the shared keymap", () => {
    const reference = formatVimKeys();

    expect(reference).toContain("pi-modal vim keybinds");
    for (const section of [
      "Normal mode",
      "Insert mode",
      "Visual mode",
      "Command mode",
      "Search mode",
    ]) {
      expect(reference).toContain(section);
    }
    expect(reference).toContain("delete line");
    expect(reference).toContain("move left");
  });
});
