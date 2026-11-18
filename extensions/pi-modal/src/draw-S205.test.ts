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

  it("persists a contributed setting change through its onChange handler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s205-modal-"));
    const env = createSettingsContext();
    const onChange = vi.fn();
    const contributions = [
      {
        owner: "pi-modes",
        id: "modeIndicator",
        label: "Mode indicator",
        description: "Show the active mode in the prompt status row",
        currentValue: "true",
        values: ["true", "false"],
        onChange,
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
      expect(env.component()?.render(80).join("\n")).toContain(
        "Mode indicator",
      );
      env.component()?.handleInput("\r");
      expect(onChange).toHaveBeenCalledWith("false");
      expect(contributions[0]?.currentValue).toBe("false");
      expect(env.component()?.render(80).join("\n")).toContain("false");
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

  it("S205 C02: built-in settings still render beside a contribution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s205-builtins-"));
    const env = createSettingsContext();
    const contributions = [
      {
        owner: "pi-modes",
        id: "modeIndicator",
        label: "Mode indicator",
        description: "Show the active mode",
        currentValue: "true",
        values: ["true", "false"],
      },
    ];
    const pending = showTuiSettings(
      env.ctx as never,
      dir,
      undefined,
      contributions,
    );
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    try {
      const rendered = env.component()?.render(80).join("\n") ?? "";
      expect(rendered).toContain("Border style");
      expect(rendered).toContain("Mode indicator");
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
  });

  it("S205 C03: outside TUI mode no settings dialog is opened", async () => {
    const custom = vi.fn();
    const ctx = { mode: "print", hasUI: true, ui: { custom, notify: vi.fn() } };
    await showTuiSettings(
      ctx as never,
      mkdtempSync(join(tmpdir(), "s205-print-")),
    );
    expect(custom).not.toHaveBeenCalled();
  });

  it("S205 C04: contributions from two owners both appear", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s205-two-owners-"));
    const env = createSettingsContext();
    const contributions = [
      {
        owner: "pi-modes",
        id: "modeIndicator",
        label: "Mode indicator",
        description: "Show the active mode",
        currentValue: "true",
        values: ["true", "false"],
      },
      {
        owner: "pi-dashboard",
        id: "refreshMs",
        label: "Refresh interval",
        description: "Dashboard refresh interval",
        currentValue: "1000",
        values: ["1000", "2000"],
      },
    ];
    const pending = showTuiSettings(
      env.ctx as never,
      dir,
      undefined,
      contributions,
    );
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    try {
      const rendered = env.component()?.render(80).join("\n") ?? "";
      expect(rendered).toContain("Mode indicator");
      expect(rendered).toContain("Refresh interval");
    } finally {
      env.component()?.handleInput("\x1b");
      await pending;
    }
  });
});
