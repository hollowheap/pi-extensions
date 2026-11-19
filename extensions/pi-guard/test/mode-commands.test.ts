import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getModeLayer,
  registerModeGate,
  replaceConfigModes,
} from "@hollowheap/core/modes";
import { session } from "@hollowheap/core/state";
import { AUTO_MODE } from "@hollowheap/policy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

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
    events: { on: vi.fn(), emit: vi.fn() },
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
  vi.stubEnv(
    "PI_CODING_AGENT_DIR",
    mkdtempSync(join(tmpdir(), "pi-guard modes-")),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("pi-guard modes extension", () => {
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

  it("cycles manual, edit, plan, and auto with alt+m", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();
    const shortcut = pi.shortcut();

    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("edit");
    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("plan");
    await shortcut.handler(ctx);
    expect(session(ctx.sessionManager).mode).toBe("auto");
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
        "pi-guard: plan is blocked",
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

  it("filters modes through the picker with pasted input", async () => {
    const pi = createMockPi();
    extension(pi as never);
    let component:
      | {
          render(width: number): string[];
          handleInput(data: string): void;
        }
      | undefined;
    const ctx = createContext({
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (value: string | undefined) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<string | undefined>((resolve) => {
            component = factory(
              { requestRender: vi.fn() },
              {
                fg: (_token: string, text: string) => text,
                bold: (text: string) => text,
              },
              {},
              resolve,
            );
          }),
      ),
    });

    const command = pi.command("mode").handler("", ctx);
    await vi.waitFor(() => expect(component).toBeDefined());
    component?.handleInput("\x1b[200~plan\x1b[201~");
    expect(component?.render(60).join("\n")).toContain("Filter: plan");
    component?.handleInput("\r");
    await command;
    expect(session(ctx.sessionManager).mode).toBe("plan");
  });

  it("sanitizes control bytes in restore diagnostics and vetoes", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext(
      {},
      {
        getEntries: () => [
          {
            customType: "hollowheap.core.mode",
            data: { mode: "turbo\u001b[2Jevil" },
          },
        ],
      },
    );

    pi.handler("session_start")({}, ctx);

    for (const call of (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toContain("\u001b");
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("no longer exists"),
      "warning",
    );
  });

  it("sanitizes control bytes in a restored mode veto", () => {
    const pi = createMockPi();
    extension(pi as never);
    const stop = registerModeGate(() => ({ veto: "blocked\u001b[2Jnow" }));
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
      for (const call of (ctx.ui.notify as ReturnType<typeof vi.fn>).mock
        .calls) {
        expect(String(call[0])).not.toContain("\u001b");
      }
    } finally {
      stop();
    }
  });

  it("switches to an exactly-cased config mode name and completes it", async () => {
    writeFileSync(
      join(process.env.PI_CODING_AGENT_DIR ?? "", "modes.json"),
      JSON.stringify({
        modes: {
          Review2: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "deny",
              shell: "ask",
              external: "allow",
            },
          },
        },
      }),
    );
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext({}, { getEntries: () => [] });
    pi.handler("session_start")({}, ctx);

    const complete = pi.command("mode").getArgumentCompletions;
    expect(complete?.("r").map((item) => item.value)).toContain("Review2");

    await pi.command("mode").handler("Review2", ctx);
    expect(session(ctx.sessionManager).mode).toBe("Review2");
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("unknown mode"),
      "error",
    );
  });
});
