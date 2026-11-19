import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";
import {
  type BwrapProbeResult,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/tui/frame";
import { hostUi, showDialog } from "./host.js";
import { settingsListTheme } from "./settings.js";

export interface SandboxSettingsValues {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

export interface ShowSandboxSettingsOptions {
  ctx: ExtensionContext;
  title: string;
  label: string;
  enabledDescription: (statusText: string) => string;
  offlineDescription: string;
  enabled: boolean;
  offline: boolean;
  probeBwrap?: () => BwrapProbeResult;
  onSave: (settings: SandboxSettingsValues) => void;
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

export async function showSandboxSettings(
  options: ShowSandboxSettingsOptions,
): Promise<void> {
  const { ctx } = options;
  if (ctx.mode !== "tui" || typeof hostUi(ctx).custom !== "function") return;

  const probe = (options.probeBwrap ?? probeBwrapAvailability)();
  const statusText = formatBwrapProbeStatus(probe);

  await showDialog<void>(
    ctx,
    (tui, theme, _keybindings, done) => {
      let sandboxEnabled = options.enabled;
      let sandboxOffline = options.offline;

      const list = new SettingsList(
        [
          {
            id: "sandbox-enabled",
            label: options.label,
            description: options.enabledDescription(statusText),
            currentValue: sandboxEnabled ? "on" : "off",
            values: ["off", "on"],
          },
          {
            id: "sandbox-offline",
            label: "Sandbox offline",
            description: options.offlineDescription,
            currentValue: sandboxOffline ? "on" : "off",
            values: ["off", "on"],
          },
        ],
        8,
        settingsListTheme(theme),
        (id, value) => {
          if (id === "sandbox-enabled") {
            sandboxEnabled = value === "on";
          } else if (id === "sandbox-offline") {
            sandboxOffline = value === "on";
          }
          options.onSave({ sandboxEnabled, sandboxOffline });
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
          return boxFrame(lines, width, theme, options.title);
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
