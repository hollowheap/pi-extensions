import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModeLayer, replaceConfigModes } from "@hollowheap/core/modes";
import { session } from "@hollowheap/core/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

interface MockCommand {
  handler: (args: string, ctx: unknown) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => unknown[];
}

function createMockPi() {
  const commands = new Map<string, MockCommand>();
  return {
    registerCommand: vi.fn((name: string, def: MockCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn(),
    on: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
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
  vi.stubEnv(
    "PI_CODING_AGENT_DIR",
    mkdtempSync(join(tmpdir(), "canonical-mode-names-modes-")),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("mode naming", () => {
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

  it("completions offer manual but not the legacy aliases", () => {
    const pi = createMockPi();
    extension(pi as never);
    const values = (pi.command("mode").getArgumentCompletions?.("") ?? []).map(
      (c) => (c as { value: string }).value,
    );
    expect(values).toContain("manual");
    expect(values).not.toContain("ask");
    expect(values).not.toContain("autopilot");
  });

  it("an unknown mode is rejected without switching the session", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    await pi.command("mode").handler("turbo", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "error");
    expect(session(ctx.sessionManager).mode).toBe("manual");
  });

  it("a bare settings subcommand reports usage", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    await pi.command("mode").handler("settings", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("usage"),
      "error",
    );
  });
});
