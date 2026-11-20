import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  DEFAULT_TUI_CONFIG,
  getTuiConfigPath,
} from "@hollowheap/core/tui-config";
import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTuiStatus, showTuiSettings } from "../src/settings.js";

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
  const requestRender = vi.fn();
  const invalidate = vi.fn();
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
            component = factory(
              { requestRender, invalidate },
              theme,
              {},
              resolve,
            );
          }),
      ),
    },
  };
  return { ctx, notify, requestRender, invalidate, component: () => component };
}

describe("showTuiSettings", () => {
  it("formats status cleanly", () => {
    const status = formatTuiStatus(DEFAULT_TUI_CONFIG);
    expect(status).toContain("borderStyle=rounded");
    expect(status).toContain("colored=true");
    expect(status).toContain("loadingIndicator=crush");
    expect(status).toContain("loadingIndicatorColor=gradient");
    expect(status).toContain("loadingIndicatorFade=true");
    expect(status).toContain("markdownRender=true");
    expect(status).toContain("thinkingVerbosity=verbose");
    expect(status).toContain("thinkingAnimate=true");
    expect(status).toContain("shimmerSpeed=normal");
    expect(status).toContain("toolVerbosity=medium");
    expect(status).toContain("panel.enabled=true");
  });

  it("cycles settings live, triggers repaint, updates active state, and persists tui.json", async () => {
    const dir = makeTempDir();
    const env = createSettingsContext();
    const onChange = vi.fn();

    const pending = showTuiSettings(env.ctx as never, dir, onChange);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    try {
      const rendered = env.component()?.render(80).join("\n") ?? "";
      expect(rendered).toContain("TUI settings");
      expect(rendered).toContain("Border style");
      expect(rendered).toContain("Overlay surface");
      expect(rendered).toContain("Colored UI");
      expect(rendered).toContain("Mode indicator");

      // Cycle borderStyle from "rounded" -> "sharp"
      env.component()?.handleInput("\r");
      expect(getActiveTuiConfig().borderStyle).toBe("sharp");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(env.requestRender).toHaveBeenCalledTimes(1);
      expect(env.requestRender).toHaveBeenCalledWith();

      const saved = JSON.parse(readFileSync(getTuiConfigPath(dir), "utf8")) as {
        borderStyle: string;
      };
      expect(saved.borderStyle).toBe("sharp");
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
    expect(env.requestRender).toHaveBeenCalledTimes(1);
  });

  it("keeps separate tab contents and persists all Tool verbosity levels", async () => {
    const dir = makeTempDir();
    const env = createSettingsContext();
    const onChange = vi.fn();
    const pending = showTuiSettings(env.ctx as never, dir, onChange);
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    const component = env.component();
    if (!component) throw new Error("Missing settings dialog");

    try {
      const appearance = component.render(80).join("\n");
      expect(appearance).toContain("\x1b[7m Appearance \x1b[27m");
      expect(appearance).toContain("Mode indicator");
      expect(appearance).not.toContain("Thinking verbosity");
      expect(appearance).not.toContain("Tool verbosity");

      component.handleInput("\t");
      const verbosity = component.render(80).join("\n");
      expect(verbosity).toContain("\x1b[7m Verbosity \x1b[27m");
      expect(verbosity).toContain("Thinking verbosity");
      expect(verbosity).toMatch(/Tool verbosity\s+medium/);
      expect(verbosity).not.toContain("Border style");
      expect(
        component.render(22).every((line) => visibleWidth(line) <= 22),
      ).toBe(true);

      component.handleInput("\x1b[B");
      for (const level of ["high", "low", "medium"]) {
        component.handleInput("\r");
        expect(getActiveTuiConfig().toolVerbosity).toBe(level);
        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ toolVerbosity: level }),
        );
        expect(
          JSON.parse(readFileSync(getTuiConfigPath(dir), "utf8")),
        ).toMatchObject({
          toolVerbosity: level,
        });
      }
      expect(env.invalidate).toHaveBeenCalledTimes(3);

      component.handleInput("\t");
      const loading = component.render(80).join("\n");
      expect(loading).toContain("\x1b[7m Loading \x1b[27m");
      expect(loading).toContain("Loading indicator");
      expect(loading).toContain("Loading color");
      expect(loading).toContain("Loading fade");
      expect(loading).toContain("Shimmer speed");
      expect(loading).not.toContain("Enable panel customization");

      component.handleInput("\t");
      const panelTab = component.render(80).join("\n");
      expect(panelTab).toContain("\x1b[7m Panel \x1b[27m");
      expect(panelTab).toContain("Enable panel customization");
      expect(panelTab).toContain("Panel accent stripe");
      expect(panelTab).toContain("Panel outcome badges");
      expect(panelTab).toContain("Panel spinner");

      component.handleInput("\r");
      expect(getActiveTuiConfig().panel.enabled).toBe(false);
      component.handleInput("\r");
      expect(getActiveTuiConfig().panel.enabled).toBe(true);

      component.handleInput("\x1b[Z");
      expect(component.render(80).join("\n")).toContain(
        "\x1b[7m Loading \x1b[27m",
      );
      component.handleInput("\x1b[Z");
      expect(component.render(80).join("\n")).toContain(
        "\x1b[7m Verbosity \x1b[27m",
      );
      component.handleInput("\x1b[Z");
      expect(component.render(80).join("\n")).toContain(
        "\x1b[7m Appearance \x1b[27m",
      );
    } finally {
      component.handleInput("\x1b");
      await pending;
    }
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
