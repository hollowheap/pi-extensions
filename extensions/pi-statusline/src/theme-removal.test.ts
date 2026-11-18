import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function capture() {
  const registered: string[] = [];
  const shortcuts: unknown[][] = [];
  const commands = new Map<
    string,
    { getArgumentCompletions?: (p: string) => unknown[] }
  >();
  const pi = {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    registerShortcut: vi.fn((...args: unknown[]) => shortcuts.push(args)),
    registerCommand: vi.fn(
      (
        name: string,
        def: { getArgumentCompletions?: (p: string) => unknown[] },
      ) => {
        registered.push(name);
        commands.set(name, def);
      },
    ),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    getCommands: vi.fn(() => []),
  };
  extension(pi as never);
  return { registered, shortcuts, commands };
}

describe("statusline theme ownership", () => {
  it("S194 C01: no theme command or picker is registered", () => {
    const registered: string[] = [];
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerShortcut: vi.fn(),
      registerCommand: vi.fn((name: string) => registered.push(name)),
      events: { on: vi.fn(() => () => {}), emit: vi.fn() },
      getCommands: vi.fn(() => []),
    };
    extension(pi as never);
    expect(registered).not.toContain("theme");
  });

  it("S194 C02: the statusline command is still registered", () => {
    const { registered } = capture();
    expect(registered).toContain("statusline");
    expect(registered).not.toContain("theme");
  });

  it("S194 C03: no theme shortcut is registered", () => {
    const { shortcuts } = capture();
    expect(
      shortcuts.some((args) => JSON.stringify(args).includes("theme")),
    ).toBe(false);
  });

  it("S194 C04: statusline completions offer no theme subcommand", () => {
    const { commands } = capture();
    const completions = commands
      .get("statusline")
      ?.getArgumentCompletions?.("");
    expect(completions?.length).toBeGreaterThan(0);
    expect(
      completions?.map((c) => (c as { value: string }).value),
    ).not.toContain("theme");
  });
});
