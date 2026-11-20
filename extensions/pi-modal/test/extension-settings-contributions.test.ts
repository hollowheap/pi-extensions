import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetActiveTuiConfig } from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showTuiSettings } from "../src/settings.js";

interface Component {
  render(width: number): string[];
  handleInput(data: string): void;
}

const createdDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-modal-settings-tabs-"));
  createdDirs.push(dir);
  return dir;
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
              { requestRender: vi.fn(), invalidate: vi.fn() },
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
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("/ui settings tabs", () => {
  it("persists modeIndicator in the Appearance tab", async () => {
    const dir = makeTempDir();
    const env = createSettingsContext();
    const onChange = vi.fn();

    const pending = showTuiSettings(env.ctx as never, dir, onChange);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    try {
      const rendered = env.component()?.render(80).join("\n") ?? "";
      expect(rendered).toContain("\x1b[7m Appearance \x1b[27m");
      expect(rendered).toContain("Mode indicator");

      env.component()?.handleInput("\x1b[B");
      env.component()?.handleInput("\x1b[B");
      env.component()?.handleInput("\x1b[B");
      env.component()?.handleInput("\r");

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ modeIndicator: false }),
      );
      const saved = JSON.parse(
        readFileSync(join(dir, "tui.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(saved.modeIndicator).toBe(false);
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
  });

  it("only manages tui.json tabs (Appearance, Verbosity, Loading) and never touches statusline.json or dashboard.json", async () => {
    const dir = makeTempDir();
    const env = createSettingsContext();
    const onChange = vi.fn();

    const pending = showTuiSettings(env.ctx as never, dir, onChange);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    try {
      const appearanceView = env.component()?.render(80).join("\n") ?? "";
      expect(appearanceView).toContain("\x1b[7m Appearance \x1b[27m");
      expect(appearanceView).not.toContain("Statusline");
      expect(appearanceView).not.toContain("Dashboard");

      // Shift+Tab wraps directly to Panel tab
      env.component()?.handleInput("\x1b[Z");
      const panelView = env.component()?.render(80).join("\n") ?? "";
      expect(panelView).toContain("\x1b[7m Panel \x1b[27m");
      expect(panelView).toContain("Enable panel customization");

      // Shift+Tab goes to Loading tab
      env.component()?.handleInput("\x1b[Z");
      const loadingView = env.component()?.render(80).join("\n") ?? "";
      expect(loadingView).toContain("\x1b[7m Loading \x1b[27m");

      // Shift+Tab goes to Verbosity tab
      env.component()?.handleInput("\x1b[Z");
      const verbosityView = env.component()?.render(80).join("\n") ?? "";
      expect(verbosityView).toContain("\x1b[7m Verbosity \x1b[27m");

      expect(existsSync(join(dir, "statusline.json"))).toBe(false);
      expect(existsSync(join(dir, "dashboard.json"))).toBe(false);
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
  });

  it("outside TUI mode no settings dialog is opened", async () => {
    const custom = vi.fn();
    const ctx = { mode: "print", hasUI: true, ui: { custom, notify: vi.fn() } };
    await showTuiSettings(ctx as never, makeTempDir());
    expect(custom).not.toHaveBeenCalled();
  });
});
