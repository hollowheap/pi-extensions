import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetActiveTuiConfig } from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showTuiSettings } from "./tui-settings.js";

interface Component {
  render(width: number): string[];
  handleInput(data: string): void;
}

function createSettingsContext() {
  let component: Component | undefined;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: vi.fn(),
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void,
          ) => Component,
        ) =>
          new Promise<void>((resolve) => {
            component = factory(
              { requestRender: vi.fn() },
              {
                fg: (_t: string, text: string) => text,
                bold: (t: string) => t,
              },
              {},
              resolve,
            );
          }),
      ),
    },
  };
  return { ctx, component: () => component };
}

afterEach(() => {
  resetActiveTuiConfig();
});

describe("S205 extension-contributed TUI settings", () => {
  it("renders settings contributed by a loaded extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s205-modal-"));
    const env = createSettingsContext();
    const contributions = [
      {
        owner: "pi-modes",
        id: "modeIndicator",
        label: "Mode indicator",
        description: "Show the active mode in the prompt status row",
        currentValue: "true",
        values: ["true", "false"],
      },
    ];

    const show = showTuiSettings as unknown as (
      ctx: unknown,
      agentDir: string,
      onChange: unknown,
      contributed: unknown,
    ) => Promise<void>;
    const pending = show(env.ctx, dir, undefined, contributions);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    try {
      const rendered = env.component()?.render(80).join("\n") ?? "";
      expect(rendered).toContain("Mode indicator");
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
  });

  it("renders no mode indicator setting when no extension contributes one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s205-modal-"));
    const env = createSettingsContext();

    const pending = showTuiSettings(env.ctx as never, dir);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    try {
      const rendered = env.component()?.render(80).join("\n") ?? "";
      expect(rendered).not.toContain("Mode indicator");
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
  });
});
