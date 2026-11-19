import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type BwrapProbeResult,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";
import { showSettingsDialog } from "./settings.js";

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
  const probe = (options.probeBwrap ?? probeBwrapAvailability)();
  const statusText = formatBwrapProbeStatus(probe);
  const statusTone = probe.available
    ? "success"
    : probe.reason === "permission"
      ? "error"
      : "warning";

  let sandboxEnabled = options.enabled;
  let sandboxOffline = options.offline;

  await showSettingsDialog({
    ctx: options.ctx,
    title: options.title,
    listHeight: 8,
    items: [
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
    header: (_list, theme) => [
      theme.fg(statusTone, `Bubblewrap (bwrap): ${statusText}`),
      "",
    ],
    onChange: (id, value) => {
      if (id === "sandbox-enabled") {
        sandboxEnabled = value === "on";
      } else if (id === "sandbox-offline") {
        sandboxOffline = value === "on";
      }
      options.onSave({ sandboxEnabled, sandboxOffline });
    },
  });
}
