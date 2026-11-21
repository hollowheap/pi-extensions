import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

describe("pi-hooks registers no model-callable tool", () => {
  it("registers only event handlers and commands, never a tool", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    extension(pi as never);

    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalled();
  });
});

describe("command registration and handler seams", () => {
  it("the hooks command advertises settings/status completions", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);

    const [name, config] = pi.registerCommand.mock.calls[0] as [
      string,
      {
        description: string;
        getArgumentCompletions: (prefix: string) => { value: string }[] | null;
      },
    ];
    expect(name).toBe("hooks");
    expect(config.description).toContain("/hooks");
    expect(config.getArgumentCompletions("s")?.map((c) => c.value)).toEqual([
      "settings",
      "status",
    ]);
    expect(config.getArgumentCompletions("x y z")).toBeNull();
  });

  it("an unknown hooks subcommand notifies usage without side effects", async () => {
    const notify = vi.fn();
    const commands: Record<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    > = {};
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn((name: string, config: never) => {
        commands[name] = config as (typeof commands)[string];
      }),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = { hasUI: true, ui: { notify } };

    await commands.hooks.handler("bogus", ctx);

    expect(notify).toHaveBeenCalledWith(
      "Usage: /hooks [settings|status]",
      "info",
    );
  });

  it("the status subcommand publishes a hook/sandbox summary", async () => {
    const notify = vi.fn();
    const commands: Record<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    > = {};
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn((name: string, config: never) => {
        commands[name] = config as (typeof commands)[string];
      }),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      ui: { notify },
    };

    await commands.hooks.handler("status", ctx);

    const summary = notify.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("Hooks:"));
    expect(summary).toContain("Hooks:");
    expect(summary).toContain("Sandbox:");
    expect(summary).toContain("Bubblewrap");
  });
});
