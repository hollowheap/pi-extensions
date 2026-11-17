import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceConfigModes } from "@hollowheap/core/modes";
import { session } from "@hollowheap/core/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

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
    events: { emit: vi.fn() },
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

function createContext(entries: unknown[] = []) {
  return {
    mode: "print",
    hasUI: true,
    sessionManager: { getEntries: () => entries },
    ui: { notify: vi.fn(), custom: vi.fn() },
  };
}

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "s203-modes-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  writeFileSync(
    join(agentDir, "modes.json"),
    JSON.stringify({
      modes: {
        review: {
          defaults: {
            read: "allow",
            search: "allow",
            edit: "deny",
            shell: "ask",
            external: "allow",
          },
        },
        plan: {
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
});

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("S203 default mode settings", () => {
  it("persists a default mode through the mode command settings subcommand", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createContext();

    await pi.command("mode").handler("settings default plan", ctx);

    const saved = JSON.parse(
      readFileSync(join(agentDir, "modes.json"), "utf8"),
    ) as { default?: string };
    expect(saved.default).toBe("plan");
  });

  it("applies the configured default only to sessions with no persisted mode", async () => {
    const pi = createMockPi();
    extension(pi as never);
    await pi.command("mode").handler("settings default plan", createContext());

    const fresh = createContext();
    pi.fire("session_start", fresh);
    expect(session(fresh.sessionManager).mode).toBe("plan");

    const resumed = createContext([
      {
        customType: "hollowheap.core.mode",
        data: { mode: "review" },
      },
    ]);
    pi.fire("session_start", resumed);
    expect(session(resumed.sessionManager).mode).toBe("review");
  });

  it("rejects an unknown default mode without replacing the saved default", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const saveCtx = createContext();
    await pi.command("mode").handler("settings default plan", saveCtx);
    const savedBefore = readFileSync(join(agentDir, "modes.json"), "utf8");

    const ctx = createContext();
    await pi.command("mode").handler("settings default turbo", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("turbo"),
      "error",
    );
    expect(readFileSync(join(agentDir, "modes.json"), "utf8")).toBe(
      savedBefore,
    );
  });
});
