import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TUI_CONFIG,
  getTuiConfigPath,
} from "@hollowheap/core/tui-config";
import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTuiStatus, showTuiSettings } from "./tui-settings.js";

const createdDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-tui-settings-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetActiveTuiConfig();
  for (const dir of createdDirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // ignore cleanup error
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const theme = {
  fg: (_token: string, text: string) => text,
  bg: (token: string, text: string) => `[${token}]${text}[/]`,
  bold: (text: string) => text,
};

function createSettingsContext() {
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;
  const notify = vi.fn();
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify,
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<void>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, notify, component: () => component };
}

describe("showTuiSettings", () => {
  it("formats status cleanly", () => {
    expect(formatTuiStatus(DEFAULT_TUI_CONFIG)).toContain(
      "borderStyle=rounded",
    );
    expect(formatTuiStatus(DEFAULT_TUI_CONFIG)).toContain(
      "toolBox.enabled=false",
    );
  });

  it("cycles settings live, updates active state, and persists tui.json", async () => {
    const dir = makeTempDir();
    const env = createSettingsContext();
    const onChange = vi.fn();

    const pending = showTuiSettings(env.ctx as never, dir, onChange);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("TUI settings");
    expect(rendered).toContain("Border style");

    // Cycle borderStyle from "rounded" -> "sharp"
    env.component()?.handleInput("\r");
    expect(getActiveTuiConfig().borderStyle).toBe("sharp");
    expect(onChange).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(readFileSync(getTuiConfigPath(dir), "utf8")) as {
      borderStyle: string;
    };
    expect(saved.borderStyle).toBe("sharp");

    env.component()?.handleInput("\x1b");
    await pending;
  });

  it("notifies error when persisting tui.json fails due to OS permissions", async () => {
    if (process.getuid?.() === 0) return;
    const dir = makeTempDir();
    const path = getTuiConfigPath(dir);
    writeFileSync(path, JSON.stringify({ borderStyle: "rounded" }), "utf8");
    chmodSync(dir, 0o500);

    try {
      const env = createSettingsContext();
      const pending = showTuiSettings(env.ctx as never, dir);
      await vi.waitFor(() => expect(env.component()).toBeDefined());

      env.component()?.handleInput("\r");
      expect(env.notify).toHaveBeenCalledWith(
        expect.stringMatching(/EACCES|permission denied/i),
        "error",
      );

      env.component()?.handleInput("\x1b");
      await pending;
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
