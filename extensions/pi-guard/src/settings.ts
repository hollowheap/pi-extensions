import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingsListTheme } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { getFrameInnerWidth, roundedFrame } from "@hollowheap/tui/frame";
import {
  type GuardConfig,
  getGuardConfigPath,
  loadGuardConfig,
  saveGuardConfig,
} from "./config.js";
import { resolveCanonicalPath } from "./rules.js";

export interface GuardStatusInfo {
  mode: string;
  agentDir: string;
  trustedRootsCount: number;
  savedDecisionsCount: number;
  activeGrantsCount: number;
}

export interface GuardSettingsOptions {
  ctx: ExtensionContext;
  agentDir: string;
  cwd: string;
  activeGrantCount: () => number;
  onClearGrants: () => number;
  onClearSavedDecisions?: () => void;
}

function settingsTheme(theme: Theme): SettingsListTheme {
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

/** Format a concise summary of active pi-guard policy state and config path. */
export function formatGuardStatus(info: GuardStatusInfo): string {
  return [
    `mode=${info.mode}`,
    `trustedRoots=${info.trustedRootsCount}`,
    `savedRules=${info.savedDecisionsCount}`,
    `activeGrants=${info.activeGrantsCount}`,
    `config=${getGuardConfigPath(info.agentDir)}`,
  ].join(" · ");
}

/** Open an interactive settings/overview menu for pi-guard. */
export async function showGuardSettings(
  options: GuardSettingsOptions,
): Promise<void> {
  const { ctx, agentDir, cwd } = options;
  let guardConfig: GuardConfig = loadGuardConfig(agentDir, (msg) => {
    if (ctx.hasUI) {
      ctx.ui.notify(`pi-guard: ${msg}`, "warning");
    }
  });

  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return;
  }

  const canonicalCwd = resolveCanonicalPath(cwd, ".");
  const isWorkspaceTrusted = (cfg: GuardConfig): boolean =>
    (cfg.trustedRoots ?? []).some(
      (root) => resolveCanonicalPath(cwd, root) === canonicalCwd,
    );

  await withPromptLock(() =>
    ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          done();
        };

        const trustValue = (cfg: GuardConfig): string =>
          isWorkspaceTrusted(cfg) ? "trusted" : "prompt";

        const list = new SettingsList(
          [
            {
              id: "trust-cwd",
              label: "Trust current workspace",
              description: `Persist ${canonicalCwd} in guard.json trustedRoots`,
              currentValue: trustValue(guardConfig),
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
              description:
                "Clear saved path allow/deny decisions in guard.json",
              currentValue: "keep",
              values: ["keep", "clear"],
            },
          ],
          6,
          settingsTheme(theme),
          (id, newValue) => {
            if (id === "trust-cwd") {
              const prevTrust = trustValue(guardConfig);
              const existingRoots = guardConfig.trustedRoots ?? [];
              const filteredRoots = existingRoots.filter(
                (root) => resolveCanonicalPath(cwd, root) !== canonicalCwd,
              );
              const nextRoots =
                newValue === "trusted"
                  ? [...filteredRoots, canonicalCwd]
                  : filteredRoots;
              const nextConfig: GuardConfig = {
                ...guardConfig,
                trustedRoots: nextRoots,
              };
              const res = saveGuardConfig(agentDir, nextConfig);
              if (!res.ok) {
                list.updateValue("trust-cwd", prevTrust);
                if (ctx.hasUI) {
                  ctx.ui.notify(
                    `pi-guard: ${sanitizeTerminalText(res.error)}`,
                    "error",
                  );
                }
              } else {
                guardConfig = nextConfig;
                if (ctx.hasUI) {
                  ctx.ui.notify(
                    newValue === "trusted"
                      ? `pi-guard: trusted workspace ${canonicalCwd}`
                      : `pi-guard: removed workspace trust for ${canonicalCwd}`,
                    "info",
                  );
                }
              }
              tui.requestRender();
              return;
            }

            if (id === "clear-grants") {
              if (newValue === "clear") {
                const cleared = options.onClearGrants();
                if (ctx.hasUI) {
                  ctx.ui.notify(
                    `pi-guard: cleared ${cleared} temporary grant(s)`,
                    "info",
                  );
                }
                list.updateValue("clear-grants", "keep");
                tui.requestRender();
              }
              return;
            }

            if (id === "clear-decisions") {
              if (newValue === "clear") {
                const nextConfig: GuardConfig = {
                  ...guardConfig,
                  decisions: {},
                };
                const res = saveGuardConfig(agentDir, nextConfig);
                if (!res.ok) {
                  if (ctx.hasUI) {
                    ctx.ui.notify(
                      `pi-guard: ${sanitizeTerminalText(res.error)}`,
                      "error",
                    );
                  }
                } else {
                  guardConfig = nextConfig;
                  options.onClearSavedDecisions?.();
                  if (ctx.hasUI) {
                    ctx.ui.notify(
                      "pi-guard: cleared saved path decisions",
                      "info",
                    );
                  }
                }
                list.updateValue("clear-decisions", "keep");
                tui.requestRender();
              }
            }
          },
          finish,
        );

        return {
          render(width: number): string[] {
            const innerWidth = getFrameInnerWidth(width);
            const summary = theme.fg(
              "muted",
              `Trusted roots: ${(guardConfig.trustedRoots ?? []).length} · Saved rules: ${Object.keys(guardConfig.decisions ?? {}).length} · Active grants: ${options.activeGrantCount()}`,
            );
            return roundedFrame(
              [summary, "", ...list.render(innerWidth)],
              width,
              theme,
              "Guard settings",
            );
          },
          invalidate() {
            list.invalidate();
          },
          handleInput(data: string) {
            list.handleInput(data);
            tui.requestRender();
          },
          dispose(): void {
            finish();
          },
        };
      },
      { overlay: true },
    ),
  );
}
