import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModeLayer, replaceConfigModes } from "@hollowheap/core/modes";
import { session } from "@hollowheap/core/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

interface MockCommand {
  handler: (args: string, ctx: unknown) => Promise<void>;
}

function createMockPi() {
  const commands = new Map<string, MockCommand>();
  return {
    registerCommand: vi.fn((name: string, def: MockCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn(),
    on: vi.fn(),
    events: { emit: vi.fn() },
    command: (name: string): MockCommand => {
      const command = commands.get(name);
      if (command === undefined) throw new Error(`missing command ${name}`);
      return command;
    },
  };
}

function createContext() {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: {},
    ui: { notify: vi.fn(), custom: vi.fn() },
  };
}

beforeEach(() => {
  vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "s200-modes-")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("S200 mode naming", () => {
  it("rejects the legacy ask alias with a diagnostic that points to manual", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    await pi.command("mode").handler("ask", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("manual"),
      "error",
    );
    expect(session(ctx.sessionManager).mode).toBe("manual");
  });

  it("rejects the legacy autopilot alias with a diagnostic", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    await pi.command("mode").handler("autopilot", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "error");
    expect(session(ctx.sessionManager).mode).not.toBe("auto");
  });

  it("keeps the ask effect name in manual defaults", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(getModeLayer("manual")?.defaults).toMatchObject({
      edit: "ask",
      shell: "ask",
    });
  });
});
