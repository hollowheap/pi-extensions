import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModeLayer, replaceConfigModes } from "@hollowheap/core/modes";
import { session } from "@hollowheap/core/state";
import { AUTO_MODE } from "@hollowheap/policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("mode registration seam", () => {
  it("registers the mode command, alt+m shortcut, and the auto layer", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "draw-s13-")));
    const commands = new Map<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    >();
    const shortcuts = new Map<string, { handler: () => Promise<void> }>();
    const pi = {
      registerCommand: vi.fn(
        (
          name: string,
          def: { handler: (args: string, ctx: unknown) => Promise<void> },
        ) => {
          commands.set(name, def);
        },
      ),
      registerShortcut: vi.fn(
        (key: string, def: { handler: () => Promise<void> }) => {
          shortcuts.set(key, def);
        },
      ),
      on: vi.fn(() => () => {}),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    extension(pi as never);

    expect(commands.has("mode")).toBe(true);
    expect(shortcuts.has("alt+m")).toBe(true);
    expect(AUTO_MODE.name).toBe("auto");
    expect(getModeLayer("auto")?.defaults.shell).toBe("allow");

    const sessionManager = {
      getBranch: vi.fn(() => []),
      appendCustomEntry: vi.fn(),
    };
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager,
      ui: { notify: vi.fn() },
    };
    await commands.get("mode")?.handler("auto", ctx);
    expect(pi.events.emit).toHaveBeenCalledWith("mode:changed", {
      mode: "auto",
    });
  });
});

describe("mode command boundary, unknown mode and shortcut cycle", () => {
  function setupModes() {
    vi.stubEnv(
      "PI_CODING_AGENT_DIR",
      mkdtempSync(join(tmpdir(), "draw-s13-extra-")),
    );
    const commands = new Map<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    >();
    const shortcuts = new Map<
      string,
      { handler: (ctx: unknown) => Promise<void> }
    >();
    const pi = {
      registerCommand: vi.fn(
        (
          name: string,
          def: { handler: (args: string, ctx: unknown) => Promise<void> },
        ) => {
          commands.set(name, def);
        },
      ),
      registerShortcut: vi.fn(
        (key: string, def: { handler: (ctx: unknown) => Promise<void> }) => {
          shortcuts.set(key, def);
        },
      ),
      on: vi.fn(() => () => {}),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: {
        getBranch: vi.fn(() => []),
        appendCustomEntry: vi.fn(),
      },
      ui: { notify: vi.fn() },
    };
    return { commands, shortcuts, pi, ctx };
  }

  it("/mode with no argument lists registered modes without a picker", async () => {
    const { commands, ctx } = setupModes();
    await commands.get("mode")?.handler("", ctx);
    const messages = ctx.ui.notify.mock.calls
      .map(([message]) => String(message))
      .join(" ");
    expect(messages).toContain("manual");
    expect(messages).toContain("auto");
  });

  it("/mode with an unknown mode reports an error and keeps the mode", async () => {
    const { commands, ctx } = setupModes();
    await commands.get("mode")?.handler("draw-s13-missing", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("unknown mode"),
      "error",
    );
    expect(session(ctx.sessionManager).mode).toBe("manual");
  });

  it("alt+m cycles the registered layers and publishes each change", async () => {
    const { shortcuts, pi, ctx } = setupModes();
    await shortcuts.get("alt+m")?.handler(ctx);
    await shortcuts.get("alt+m")?.handler(ctx);
    const emitted = pi.events.emit.mock.calls.map(([, value]) => value);
    expect(emitted).toEqual([{ mode: "edit" }, { mode: "plan" }]);
  });
});
