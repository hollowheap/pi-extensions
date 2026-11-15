import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingsListTheme } from "@earendil-works/pi-tui";
import {
  type BwrapProbeResult,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";
import { getFrameInnerWidth, roundedFrame } from "@hollowheap/tui/frame";
import {
  type TasksConfig,
  type TasksSettings,
  isSandboxEnabled,
  isSandboxOffline,
} from "./config.js";

const TOGGLES = ["off", "on"];

function themeFor(theme: Theme): SettingsListTheme {
  return {
    label: (text, selected) =>
      selected ? theme.fg("accent", text) : theme.fg("text", text),
    value: (text, selected) =>
      selected ? theme.fg("accent", text) : theme.fg("muted", text),
    description: (text) => theme.fg("muted", text),
    cursor: theme.fg("accent", "› "),
    hint: (text) => theme.fg("dim", text),
  };
}

export function formatBwrapProbeStatus(probe: BwrapProbeResult): string {
  if (probe.available) {
    return `available (${probe.path})`;
  }
  if (probe.reason === "permission") {
    return `OS permission error (${probe.path ?? "bwrap"} — check permissions)`;
  }
  if (probe.reason === "unsupported") {
    return "unsupported (Linux user namespaces required)";
  }
  return "missing ('bwrap' not found on PATH)";
}

export async function showTasksSettings(
  ctx: ExtensionContext,
  config: TasksConfig,
  onSave: (settings: TasksSettings) => void,
  probeBwrap: () => BwrapProbeResult = () => probeBwrapAvailability(),
): Promise<void> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return;

  const probe = probeBwrap();
  const statusText = formatBwrapProbeStatus(probe);

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let sandboxEnabled = isSandboxEnabled(config.sandbox);
      let sandboxOffline = isSandboxOffline(config.sandbox);

      const list = new SettingsList(
        [
          {
            id: "sandbox-enabled",
            label: "Sandbox tasks (bwrap)",
            description: `Isolate background shell tasks in Bubblewrap (${statusText})`,
            currentValue: sandboxEnabled ? "on" : "off",
            values: TOGGLES,
          },
          {
            id: "sandbox-offline",
            label: "Sandbox offline",
            description:
              "Disable network access inside the sandbox (--unshare-net)",
            currentValue: sandboxOffline ? "on" : "off",
            values: TOGGLES,
          },
        ],
        8,
        themeFor(theme),
        (id, value) => {
          if (id === "sandbox-enabled") {
            sandboxEnabled = value === "on";
          } else if (id === "sandbox-offline") {
            sandboxOffline = value === "on";
          }
          onSave({
            sandboxEnabled,
            sandboxOffline,
          });
          tui.requestRender();
        },
        () => done(),
        { enableSearch: true },
      );

      const statusTone = probe.available
        ? "success"
        : probe.reason === "permission"
          ? "error"
          : "warning";

      return {
        render(width: number): string[] {
          const innerWidth = getFrameInnerWidth(width);
          const statusLine = theme.fg(
            statusTone,
            `Bubblewrap (bwrap): ${statusText}`,
          );
          const lines = [statusLine, "", ...list.render(innerWidth)];
          return roundedFrame(lines, width, theme, "Tasks settings");
        },
        handleInput(data: string): void {
          list.handleInput(data);
        },
        invalidate(): void {
          list.invalidate();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "70%", maxHeight: "70%", margin: 1 },
    },
  );
}
