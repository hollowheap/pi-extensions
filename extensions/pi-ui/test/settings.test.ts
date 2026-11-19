import { describe, expect, it, vi } from "vitest";
import {
  notifyDiagnostics,
  runSettingsCommand,
  settingsListTheme,
  showTabbedSettingsDialog,
} from "../src/settings.js";

const theme = {
  fg: (token: string, value: string) => `[${token}]${value}[/${token}]`,
} as never;

describe("settingsListTheme", () => {
  it("uses semantic theme tokens for selection states", () => {
    const listTheme = settingsListTheme(theme);
    expect(listTheme.label("Name", true)).toBe("[accent]Name[/accent]");
    expect(listTheme.label("Name", false)).toBe("[text]Name[/text]");
    expect(listTheme.value("on", true)).toBe("[accent]on[/accent]");
    expect(listTheme.value("off", false)).toBe("[muted]off[/muted]");
    expect(listTheme.description("hint")).toBe("[muted]hint[/muted]");
    expect(listTheme.cursor).toBe("[accent]› [/accent]");
    expect(listTheme.hint("enter")).toBe("[dim]enter[/dim]");
  });

  it("returns plain text when coloring is disabled", () => {
    const listTheme = settingsListTheme(theme, () => false);
    expect(listTheme.label("Name", true)).toBe("Name");
    expect(listTheme.value("on", false)).toBe("on");
    expect(listTheme.description("hint")).toBe("hint");
    expect(listTheme.cursor).toBe("› ");
  });

  it("reads the coloring flag lazily", () => {
    let colored = false;
    const listTheme = settingsListTheme(theme, () => colored);
    expect(listTheme.cursor).toBe("› ");
    colored = true;
    expect(listTheme.cursor).toBe("[accent]› [/accent]");
  });
});

describe("notifyDiagnostics", () => {
  it("maps permission diagnostics to error and others to warning", () => {
    const notify = vi.fn();
    notifyDiagnostics({ hasUI: true, ui: { notify } } as never, "pi-tasks", [
      "EACCES: permission denied",
      "invalid timeout; using default",
    ]);

    expect(notify).toHaveBeenNthCalledWith(
      1,
      "pi-tasks: EACCES: permission denied",
      "error",
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      "pi-tasks: invalid timeout; using default",
      "warning",
    );
  });

  it("stays silent when hasUI is false", () => {
    const notify = vi.fn();
    notifyDiagnostics({ hasUI: false, ui: { notify } } as never, "pi-tasks", [
      "EACCES: permission denied",
    ]);

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("runSettingsCommand", () => {
  it("notifies diagnostics and TUI fallback when overlay is unavailable with UI", async () => {
    const notify = vi.fn();
    const open = vi.fn();

    const result = await runSettingsCommand(
      { mode: "rpc", hasUI: true, ui: { notify } } as never,
      {
        prefix: "pi-web",
        title: "Web settings",
        configPath: "/tmp/web.json",
        diagnostics: ["permission denied reading config", "unknown key"],
        open,
      },
    );

    expect(result).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(notify).toHaveBeenNthCalledWith(
      1,
      "pi-web: permission denied reading config",
      "error",
    );
    expect(notify).toHaveBeenNthCalledWith(2, "pi-web: unknown key", "warning");
    expect(notify).toHaveBeenNthCalledWith(
      3,
      "Web settings requires TUI mode; edit /tmp/web.json",
      "info",
    );
  });

  it("supports a custom nonTuiMessage when overlay is unavailable", async () => {
    const notify = vi.fn();
    const open = vi.fn();

    const result = await runSettingsCommand(
      { mode: "rpc", hasUI: true, ui: { notify } } as never,
      {
        prefix: "pi-web",
        title: "Web settings",
        configPath: "/tmp/web.json",
        nonTuiMessage: "Edit /tmp/web.json directly",
        open,
      },
    );

    expect(result).toBe(false);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Edit /tmp/web.json directly",
      "info",
    );
  });

  it("stays silent when overlay is unavailable and hasUI is false", async () => {
    const notify = vi.fn();
    const open = vi.fn();

    const result = await runSettingsCommand(
      { mode: "print", hasUI: false, ui: { notify } } as never,
      {
        prefix: "pi-web",
        title: "Web settings",
        configPath: "/tmp/web.json",
        diagnostics: ["unknown key"],
        open,
      },
    );

    expect(result).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("opens settings in TUI mode and notifies diagnostics and optional saved message when saved", async () => {
    const notify = vi.fn();
    const open = vi.fn().mockResolvedValue(true);

    const result = await runSettingsCommand(
      {
        mode: "tui",
        hasUI: true,
        ui: { custom: vi.fn(), notify },
      } as never,
      {
        prefix: "pi-tasks",
        title: "Task settings",
        configPath: "/tmp/tasks.json",
        diagnostics: ["invalid setting"],
        open,
        savedMessage: "Tasks settings saved",
      },
    );

    expect(result).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenNthCalledWith(
      1,
      "pi-tasks: invalid setting",
      "warning",
    );
    expect(notify).toHaveBeenNthCalledWith(2, "Tasks settings saved", "info");
  });

  it("returns false without emitting savedMessage when open returns false", async () => {
    const notify = vi.fn();
    const open = vi.fn().mockResolvedValue(false);

    const result = await runSettingsCommand(
      {
        mode: "tui",
        hasUI: true,
        ui: { custom: vi.fn(), notify },
      } as never,
      {
        prefix: "pi-tasks",
        title: "Task settings",
        configPath: "/tmp/tasks.json",
        diagnostics: ["invalid setting"],
        open,
        savedMessage: "Tasks settings saved",
      },
    );

    expect(result).toBe(false);
    expect(open).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "pi-tasks: invalid setting",
      "warning",
    );
  });

  it("guards TUI notifications with hasUI", async () => {
    const notify = vi.fn();
    const open = vi.fn().mockRejectedValue(new Error("EACCES write failed"));

    const result = await runSettingsCommand(
      {
        mode: "tui",
        hasUI: false,
        ui: { custom: vi.fn(), notify },
      } as never,
      {
        prefix: "pi-tasks",
        title: "Task settings",
        configPath: "/tmp/tasks.json",
        diagnostics: ["invalid setting"],
        open,
        savedMessage: "Tasks settings saved",
      },
    );

    expect(result).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports an error notification and returns false when open rejects", async () => {
    const notify = vi.fn();
    const open = vi.fn().mockRejectedValue(new Error("EACCES write failed"));

    const result = await runSettingsCommand(
      {
        mode: "tui",
        hasUI: true,
        ui: { custom: vi.fn(), notify },
      } as never,
      {
        prefix: "pi-subagents",
        title: "Subagent settings",
        configPath: "/tmp/subagents.json",
        open,
        savedMessage: "Subagent settings saved",
      },
    );

    expect(result).toBe(false);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "pi-subagents: failed to save settings: EACCES write failed",
      "error",
    );
  });
});

describe("showTabbedSettingsDialog", () => {
  it("switches tabs, forwards handleMouse to active list, and notifies onChange/onClose", async () => {
    let component:
      | {
          render(width: number): string[];
          handleInput(data: string): void;
          handleMouse(event: {
            kind: "press" | "release" | "move";
            button: "left" | "middle" | "right" | "wheelUp" | "wheelDown";
            x: number;
            y: number;
          }): boolean | undefined;
        }
      | undefined;
    const requestRender = vi.fn();
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        custom: vi.fn(
          (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: () => void,
            ) => typeof component,
          ) =>
            new Promise<void>((resolve) => {
              component = factory(
                { requestRender },
                { fg: (_t: string, v: string) => v, bold: (v: string) => v },
                {},
                resolve,
              );
            }),
        ),
      },
    };
    const onChange = vi.fn();
    const onClose = vi.fn();

    const pending = showTabbedSettingsDialog({
      ctx: ctx as never,
      title: "Tabbed settings",
      tabs: [
        {
          label: "First",
          items: [
            {
              id: "first-opt",
              label: "First option",
              description: "First desc",
              currentValue: "a",
              values: ["a", "b"],
            },
          ],
        },
        {
          label: "Second",
          items: [
            {
              id: "second-opt",
              label: "Second option",
              description: "Second desc",
              currentValue: "x",
              values: ["x", "y"],
            },
          ],
        },
      ],
      onChange,
      onClose,
    });

    await vi.waitFor(() => expect(component).toBeDefined());
    expect(component?.render(60).join("\n")).toContain("[First]");

    component?.handleInput("\t");
    expect(component?.render(60).join("\n")).toContain("[Second]");
    component?.handleInput("\r");
    expect(onChange).toHaveBeenCalledWith(
      "second-opt",
      "y",
      expect.anything(),
      expect.anything(),
    );

    expect(() =>
      component?.handleMouse({
        kind: "press",
        button: "left",
        x: 4,
        y: 5,
      }),
    ).not.toThrow();

    // Tab header clicks (y < offsetY) are ignored rather than forwarding negative y
    expect(
      component?.handleMouse({
        type: "press",
        button: "left",
        x: 4,
        y: 1,
        screenX: 4,
        screenY: 1,
        width: 60,
        height: 20,
      } as never),
    ).toBeUndefined();

    component?.handleInput("\x1b");
    await pending;
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
