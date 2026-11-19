import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

function pi() {
  const cmds = new Map<
    string,
    { getArgumentCompletions?: (p: string) => unknown[] }
  >();
  return {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    registerCommand: vi.fn(
      (
        name: string,
        def: { getArgumentCompletions?: (p: string) => unknown[] },
      ) => {
        cmds.set(name, def);
      },
    ),
    getCommand: (n: string) => cmds.get(n),
    getCommands: vi.fn(() => []),
    appendEntry: vi.fn(),
    setActiveTools: vi.fn(),
    getAllTools: vi.fn(() => []),
  };
}

describe("inline agent selection and shared default settings", () => {
  it("/agent exposes a settings subcommand", () => {
    const p = pi();
    extension(p as never);
    const completions =
      p.getCommand("agent")?.getArgumentCompletions?.("set") ?? [];
    expect(completions.map((c) => (c as { value: string }).value)).toContain(
      "settings",
    );
  });

  it("an empty prefix lists the built-in agent choices", () => {
    const p = pi();
    extension(p as never);
    const completions = p
      .getCommand("agent")
      ?.getArgumentCompletions?.("")
      ?.map((c) => (c as { value: string }).value);
    expect(completions).toEqual(
      expect.arrayContaining(["default", "settings"]),
    );
    expect(completions).not.toContain("reset");
  });

  it("an unmatched prefix yields no completions", () => {
    const p = pi();
    extension(p as never);
    const completions = p
      .getCommand("agent")
      ?.getArgumentCompletions?.("zzzz-no-such-agent");
    expect(completions).toEqual([]);
  });

  it("registers /agent as the sole agent selection command", () => {
    const p = pi();
    extension(p as never);
    expect(p.getCommand("agent")).toBeDefined();
    expect(p.getCommand("agents")).toBeUndefined();
  });
});
