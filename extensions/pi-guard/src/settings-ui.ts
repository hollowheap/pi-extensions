import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingsList } from "@earendil-works/pi-tui";
import { resolveCanonicalPath } from "@hollowheap/core/trust";
import { showSettingsDialog } from "@hollowheap/pi-ui/settings";
import { type Config, loadConfig, rootPath, saveConfig } from "./settings.js";
import { guardNotify, guardWarn } from "./state.js";

export interface Options {
  ctx: ExtensionContext;
  agentDir: string;
  cwd: string;
  activeGrantCount: () => number;
  onClearGrants: () => number;
  onClearSavedDecisions?: () => void;
}

function isWorkspaceTrusted(
  config: Config,
  cwd: string,
  canonicalCwd: string,
): boolean {
  return (config.trustedRoots ?? []).some(
    (root) => resolveCanonicalPath(cwd, rootPath(root)) === canonicalCwd,
  );
}

function trustValue(config: Config, cwd: string, canonicalCwd: string): string {
  return isWorkspaceTrusted(config, cwd, canonicalCwd) ? "trusted" : "prompt";
}

function nextConfigWithWorkspaceTrust(
  config: Config,
  cwd: string,
  canonicalCwd: string,
  newValue: string,
): Config {
  const filteredRoots = (config.trustedRoots ?? []).filter(
    (root) => resolveCanonicalPath(cwd, rootPath(root)) !== canonicalCwd,
  );
  const trustedRoots =
    newValue === "trusted" ? [...filteredRoots, canonicalCwd] : filteredRoots;
  return { ...config, trustedRoots };
}

function toggleWorkspaceTrust(
  dialogState: { config: Config },
  options: Options,
  canonicalCwd: string,
  list: SettingsList,
  newValue: string,
): void {
  const { ctx, agentDir, cwd } = options;
  const prevTrust = trustValue(dialogState.config, cwd, canonicalCwd);
  const next = nextConfigWithWorkspaceTrust(
    dialogState.config,
    cwd,
    canonicalCwd,
    newValue,
  );
  const result = saveConfig(agentDir, next);
  if (!result.ok) {
    list.updateValue("trust-cwd", prevTrust);
    guardNotify(ctx, result.error, "error");
    return;
  }
  dialogState.config = next;
  guardNotify(
    ctx,
    newValue === "trusted"
      ? `trusted workspace ${canonicalCwd}`
      : `removed workspace trust for ${canonicalCwd}`,
  );
}

function clearSavedDecisions(
  dialogState: { config: Config },
  options: Options,
  list: SettingsList,
): void {
  const { ctx, agentDir } = options;
  const next: Config = { ...dialogState.config, decisions: {} };
  const result = saveConfig(agentDir, next);
  if (!result.ok) {
    guardNotify(ctx, result.error, "error");
  } else {
    dialogState.config = next;
    options.onClearSavedDecisions?.();
    guardNotify(ctx, "cleared saved path decisions");
  }
  list.updateValue("clear-decisions", "keep");
}

export async function show(options: Options): Promise<void> {
  const { ctx, agentDir, cwd } = options;

  const dialogState = {
    config: loadConfig(agentDir, guardWarn(ctx)),
  };
  const canonicalCwd = resolveCanonicalPath(cwd, ".");

  await showSettingsDialog({
    ctx,
    title: "Guard settings",
    listHeight: 6,
    promptLock: true,
    items: [
      {
        id: "trust-cwd",
        label: "Trust current workspace",
        description: `Persist ${canonicalCwd} in guard.json trustedRoots`,
        currentValue: trustValue(dialogState.config, cwd, canonicalCwd),
        values: ["prompt", "trusted"],
      },
      {
        id: "clear-grants",
        label: "Temporary grants",
        description: "Clear active temporary session grants",
        currentValue: "keep",
        values: ["keep", "clear"],
      },
      {
        id: "clear-decisions",
        label: "Saved path rules",
        description: "Clear saved path allow/deny decisions in guard.json",
        currentValue: "keep",
        values: ["keep", "clear"],
      },
    ],
    header: (_list, theme) => [
      theme.fg(
        "muted",
        `Trusted roots: ${(dialogState.config.trustedRoots ?? []).length} · Saved rules: ${Object.keys(dialogState.config.decisions ?? {}).length} · Active grants: ${options.activeGrantCount()}`,
      ),
      "",
    ],
    onChange: (id, newValue, list) => {
      if (id === "trust-cwd") {
        toggleWorkspaceTrust(
          dialogState,
          options,
          canonicalCwd,
          list,
          newValue,
        );
      } else if (id === "clear-grants" && newValue === "clear") {
        const cleared = options.onClearGrants();
        guardNotify(ctx, `cleared ${cleared} temporary grant(s)`);
        list.updateValue("clear-grants", "keep");
      } else if (id === "clear-decisions" && newValue === "clear") {
        clearSavedDecisions(dialogState, options, list);
      }
    },
  });
}
