import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getModeLayer,
  registerModeGate,
  replaceConfigModes,
} from "@hollowheap/core/modes";
import { session } from "@hollowheap/core/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, { AUTO_MODE } from "./index.js";

interface MockCommand {
  handler: (args: string, ctx: unknown) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => Array<{ value: string }>;
}

interface MockShortcut {
  handler: (ctx: unknown) => Promise<void>;
}

type Handler = (event: unknown, ctx: unknown) => unknown;

function createMockPi() {
  const commands = new Map<string, MockCommand>();
  const shortcuts = new Map<string, MockShortcut>();
  const handlers = new Map<string, Handler>();
  return {
    registerCommand: vi.fn((name: string, def: MockCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn((key: string, def: MockShortcut) => {
      shortcuts.set(key, def);
    }),
    on: vi.fn((event: string, fn: Handler) => {
      handlers.set(event, fn);
    }),
    events: { emit: vi.fn() },
    command: (name: string): MockCommand => {
      const command = commands.get(name);
      if (command === undefined) throw new Error(`missing command ${name}`);
      return command;
    },
    shortcut: (): MockShortcut => {
      const shortcut = shortcuts.get("alt+m");
      if (shortcut === undefined) throw new Error("missing alt+m");
      return shortcut;
    },
    handler: (name: string): Handler => {
      const handler = handlers.get(name);
      if (handler === undefined) throw new Error(`missing handler ${name}`);
      return handler;
    },
  };
}

function createContext(
  ui: Record<string, unknown> = {},
  sessionManager: Record<string, unknown> = {},
) {
  return {
    hasUI: true,
    mode: "tui",
    sessionManager,
    ui: { notify: vi.fn(), ...ui },
  };
}

beforeEach(() => {
  vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "pi-modes-")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("pi-modes extension", () => {
  it("registers manual, edit, plan, and auto layers", () => {
    extension(createMockPi() as never);
    expect(getModeLayer("manual")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "ask",
      shell: "ask",
      external: "allow",
    });
    expect(getModeLayer("edit")?.defaults.edit).toBe("allow");
    expect(getModeLayer("plan")?.defaults.edit).toBe("deny");
    expect(getModeLayer("auto")?.defaults.shell).toBe("allow");
    expect(Object.isFrozen(AUTO_MODE)).toBe(true);
  });

  it("switches modes and maps legacy names", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    await pi.command("mode").handler("ask", ctx);
    expect(session(ctx.sessionManager).mode).toBe("manual");

    await pi.command("mode").handler("auto", ctx);
    expect(session(ctx.sessionManager).mode).toBe("auto");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("auto on"),
      "warning",
    );

    await pi.command("mode").handler("autopilot", ctx);
    expect(session(ctx.sessionManager).mode).toBe("auto");

    await pi.command("mode").handler("turbo", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("unknown mode"),
      "error",
    );
  });

  it("cycles manual, edit, and plan with alt+m without entering auto", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();
    const shortcut = pi.shortcut();

    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("edit");
    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("plan");
    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("manual");

    await pi.command("mode").handler("auto", ctx);
    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("manual");
  });

  it("completes mode names and publishes mode changes", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const complete = pi.command("mode").getArgumentCompletions;
    expect(complete?.("").map((item) => item.value)).toEqual([
      "manual",
      "edit",
      "plan",
      "auto",
    ]);
    expect(complete?.("e").map((item) => item.value)).toEqual(["edit"]);

    const ctx = createContext();
    await pi.command("mode").handler("plan", ctx);
    expect(pi.events.emit).toHaveBeenCalledWith("mode:changed", {
      mode: "plan",
    });
  });

  it("restores legacy persisted modes on session start", () => {
    const pi = createMockPi();
    extension(pi as never);
    const entries = [
      { customType: "hollowheap.core.mode", data: { mode: "ask" } },
      { customType: "hollowheap.core.mode", data: { mode: "autopilot" } },
    ];
    const ctx = createContext({}, { getEntries: () => entries });

    pi.handler("session_start")({}, ctx);

    expect(session(ctx.sessionManager).mode).toBe("auto");
    expect(pi.events.emit).toHaveBeenCalledWith("mode:changed", {
      mode: "auto",
    });
  });

  it("falls back to manual with a diagnostic for missing persisted modes", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext(
      {},
      {
        getEntries: () => [
          { customType: "hollowheap.core.mode", data: { mode: "turbo" } },
        ],
      },
    );

    pi.handler("session_start")({}, ctx);

    expect(session(ctx.sessionManager).mode).toBe("manual");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("no longer exists"),
      "warning",
    );
  });

  it("keeps manual when a restored mode is vetoed", () => {
    const pi = createMockPi();
    extension(pi as never);
    const stop = registerModeGate((mode) =>
      mode === "plan" ? { veto: "plan is blocked" } : undefined,
    );
    const ctx = createContext(
      {},
      {
        getEntries: () => [
          { customType: "hollowheap.core.mode", data: { mode: "plan" } },
        ],
      },
    );

    try {
      pi.handler("session_tree")({}, ctx);

      expect(session(ctx.sessionManager).mode).toBe("manual");
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "pi-modes: plan is blocked",
        "error",
      );
    } finally {
      stop();
    }
  });

  it("shows the mode list without TUI", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = { ...createContext(), mode: "print" };
    await pi.command("mode").handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("mode manual (manual, edit, plan, auto)"),
    );
  });
});
