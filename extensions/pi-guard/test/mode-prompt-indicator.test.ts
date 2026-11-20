import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceConfigModes } from "@hollowheap/core/modes";
import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/ui/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

interface MockCommand {
  handler: (args: string, ctx: unknown) => Promise<void>;
}

function createMockPi() {
  const commands = new Map<string, MockCommand>();
  const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
  return {
    registerCommand: vi.fn((name: string, def: MockCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn(),
    on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
      handlers.set(event, fn);
    }),
    events: { on: vi.fn(), emit: vi.fn() },
    command: (name: string): MockCommand => {
      const command = commands.get(name);
      if (command === undefined) throw new Error(`missing command ${name}`);
      return command;
    },
    fire: (event: string, ctx: unknown) => {
      const handler = handlers.get(event);
      if (handler === undefined) throw new Error(`missing handler ${event}`);
      handler({}, ctx);
    },
  };
}

function createContext() {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: { getEntries: () => [] },
    ui: { notify: vi.fn(), setStatus: vi.fn(), custom: vi.fn() },
  };
}

beforeEach(() => {
  resetActiveTuiConfig();
  vi.stubEnv(
    "PI_CODING_AGENT_DIR",
    mkdtempSync(join(tmpdir(), "mode-prompt-indicator-modes-")),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetActiveTuiConfig();
  replaceConfigModes([]);
});

describe("mode prompt indicator", () => {
  it("publishes the active mode to the prompt status row", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    pi.fire("session_start", ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("mode", "manual");

    await pi.command("mode").handler("plan", ctx);
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("mode", "plan");
  });

  it("hides only the mode indicator when the TUI hide flag is set", () => {
    const base = getActiveTuiConfig();
    setActiveTuiConfig({ ...base, modeIndicator: false } as never);

    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();
    pi.fire("session_start", ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("mode", undefined);
    expect(ctx.ui.setStatus).not.toHaveBeenCalledWith("cwd", expect.anything());
  });

  it("the default indicator writes only the mode status key", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();
    pi.fire("session_start", ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("mode", "manual");
  });

  it("the hide flag keeps the indicator hidden after a switch", async () => {
    const base = getActiveTuiConfig();
    setActiveTuiConfig({ ...base, modeIndicator: false } as never);
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();
    pi.fire("session_start", ctx);
    await pi.command("mode").handler("plan", ctx);
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("mode", undefined);
  });

  it("a persisted mode in a resumed session is reflected", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = {
      ...createContext(),
      sessionManager: {
        getEntries: () => [
          {
            customType: "hollowheap.core.mode",
            data: { mode: "plan" },
          },
        ],
      },
    };
    pi.fire("session_start", ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("mode", "plan");
  });
});
