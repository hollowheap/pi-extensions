import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModeLayer, replaceConfigModes } from "@hollowheap/core/modes";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension, { AUTO_MODE } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  replaceConfigModes([]);
});

describe("S13: mode registration seam", () => {
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
      events: { emit: vi.fn() },
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
