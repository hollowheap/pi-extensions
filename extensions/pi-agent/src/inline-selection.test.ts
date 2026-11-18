import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

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
  it("S193 C01: both agent aliases expose a settings subcommand", () => {
    const p = pi();
    extension(p as never);
    const single = p.getCommand("agent");
    const plural = p.getCommand("agents");
    expect(single).toBeDefined();
    expect(plural).toBeDefined();
    // Public seam: a settings subcommand is available under both aliases.
    const completions = single?.getArgumentCompletions?.("set") ?? [];
    expect(completions.map((c) => (c as { value: string }).value)).toContain(
      "settings",
    );
    expect(
      (plural?.getArgumentCompletions?.("set") ?? []).map(
        (c) => (c as { value: string }).value,
      ),
    ).toContain("settings");
  });

  it("S193 C02: an empty prefix lists the built-in agent choices", () => {
    const p = pi();
    extension(p as never);
    const completions = p
      .getCommand("agent")
      ?.getArgumentCompletions?.("")
      ?.map((c) => (c as { value: string }).value);
    expect(completions).toEqual(
      expect.arrayContaining(["default", "reset", "settings"]),
    );
  });

  it("S193 C03: an unmatched prefix yields no completions", () => {
    const p = pi();
    extension(p as never);
    const completions = p
      .getCommand("agent")
      ?.getArgumentCompletions?.("zzzz-no-such-agent");
    expect(completions).toEqual([]);
  });

  it("S193 C04: both aliases share one command definition and completion set", () => {
    const p = pi();
    extension(p as never);
    expect(p.getCommand("agents")).toBe(p.getCommand("agent"));
    expect(p.getCommand("agents")?.getArgumentCompletions?.("set")).toEqual(
      p.getCommand("agent")?.getArgumentCompletions?.("set"),
    );
  });
});
