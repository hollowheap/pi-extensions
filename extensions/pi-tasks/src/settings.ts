import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@hollowheap/core/records";
import {
  type SandboxConfig,
  isSandboxEnabled,
  isSandboxOffline,
  parseSandboxConfig,
  resolveSandboxOptions,
  saveSandboxConfig,
} from "@hollowheap/core/sandbox-config";
import { showSandboxSettings } from "@hollowheap/pi-ui/sandbox-settings";

import { readJsonObject } from "@hollowheap/core/config";
import {
  type BwrapProbeResult,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";

export const CONFIG_FILE_NAME = "tasks.json";

export type TasksSandboxConfig = SandboxConfig;

export interface TasksConfig {
  readonly sandbox?: boolean | TasksSandboxConfig;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

export interface TasksSettings {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

export { isSandboxEnabled, isSandboxOffline };
export const resolveTasksSandboxOptions = resolveSandboxOptions;

export function loadTasksConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): TasksConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  const parsed = readJsonObject(path, diagnostics);

  const sandbox = isRecord(parsed)
    ? parseSandboxConfig(parsed.sandbox, diagnostics)
    : undefined;

  const config: TasksConfig = {
    ...(sandbox !== undefined ? { sandbox } : {}),
    path,
    diagnostics: Object.freeze(diagnostics),
  };
  if (onDiagnostic !== undefined) {
    for (const message of config.diagnostics) onDiagnostic(message);
  }
  return config;
}

/** Persist sandbox settings in tasks.json while preserving unrelated keys. */
export function saveTasksSettings(
  agentDir: string,
  settings: TasksSettings,
): string {
  return saveSandboxConfig(join(agentDir, CONFIG_FILE_NAME), settings);
}

export { formatBwrapProbeStatus } from "@hollowheap/pi-ui/sandbox-settings";

export async function showTasksSettings(
  ctx: ExtensionContext,
  config: TasksConfig,
  onSave: (settings: TasksSettings) => void,
  probeBwrap: () => BwrapProbeResult = () => probeBwrapAvailability(),
): Promise<void> {
  await showSandboxSettings({
    ctx,
    title: "Tasks settings",
    label: "Sandbox tasks (bwrap)",
    enabledDescription: (statusText) =>
      `Isolate background shell tasks in Bubblewrap (${statusText})`,
    offlineDescription:
      "Disable network access inside the sandbox (--unshare-net)",
    enabled: isSandboxEnabled(config.sandbox),
    offline: isSandboxOffline(config.sandbox),
    probeBwrap,
    onSave,
  });
}
