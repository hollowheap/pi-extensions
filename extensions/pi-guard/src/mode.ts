import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { loadModesConfig, updateJsonConfig } from "@hollowheap/core/config";
import {
  enterMode,
  getModeLayer,
  modeNames,
  registerMode,
  replaceConfigModes,
  resetSession,
  resolveModeName,
} from "@hollowheap/core/modes";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { readPersistedMode, session } from "@hollowheap/core/state";
import { canOverlay, hostUi } from "@hollowheap/pi-ui/host";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { prefixCompletions } from "@hollowheap/ui/autocomplete";
import { getActiveTuiConfig } from "@hollowheap/ui/state";
import { isKnownMode, modesPath, readDefaultMode } from "./settings.js";
import { guardNotify, guardWarn } from "./state.js";

function publishMode(pi: ExtensionAPI, owner: unknown): void {
  const mode = session(owner).mode;
  updateSessionSnapshot(owner, "mode", { name: mode, updatedAt: Date.now() });
  pi.events?.emit?.("mode:changed", { mode });
}

function publishStatus(ctx: ExtensionContext): void {
  const ui = hostUi(ctx) as unknown as {
    setStatus?: (key: string, value: string | undefined) => void;
  };
  if (typeof ui.setStatus !== "function") return;
  const config = getActiveTuiConfig() as unknown as {
    modeIndicator?: boolean;
  };
  const visible = config.modeIndicator !== false;
  ui.setStatus("mode", visible ? session(ctx.sessionManager).mode : undefined);
}

function setDefaultMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): void {
  if (name === "" || !isKnownMode(name)) {
    guardNotify(ctx, `unknown mode "${name}"`, "error");
    return;
  }
  const canonical = getModeLayer(name)?.name ?? resolveModeName(name);
  const result = updateJsonConfig(modesPath(), (root) => {
    root.default = canonical;
  });
  if (!result.ok) {
    guardNotify(ctx, result.error, "error");
    return;
  }
  guardNotify(ctx, `default mode ${canonical}`);
  publishMode(pi, ctx.sessionManager);
}

function switchMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  raw: string,
): void {
  const result = enterMode(ctx.sessionManager, raw);
  if (result.diagnostic !== undefined) {
    guardNotify(ctx, result.diagnostic, "error");
    return;
  }
  if (result.veto !== undefined) {
    guardNotify(ctx, result.veto, "error");
    return;
  }
  if (result.notices.length > 0) {
    for (const notice of result.notices) {
      guardNotify(ctx, notice.text, notice.level);
    }
  } else {
    guardNotify(ctx, `mode ${result.mode}`);
  }
  publishMode(pi, ctx.sessionManager);
  publishStatus(ctx);
}

async function pickMode(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const names = modeNames();
  if (canOverlay(ctx)) {
    const { showFuzzyPicker } = await import("@hollowheap/pi-ui/picker");
    const picked = await showFuzzyPicker(ctx, {
      title: "Select mode",
      items: names.map((name) => {
        const layer = getModeLayer(name);
        const description = layer?.description ?? "approval mode";
        return {
          value: name,
          label: name,
          description,
          preview: [
            `${name} — ${description}`,
            `read: ${layer?.defaults.read ?? "ask"}`,
            `search: ${layer?.defaults.search ?? "ask"}`,
            `edit: ${layer?.defaults.edit ?? "ask"}`,
            `shell: ${layer?.defaults.shell ?? "ask"}`,
            `external: ${layer?.defaults.external ?? "ask"}`,
          ],
        };
      }),
      emptyText: "No modes registered",
    });
    if (picked !== undefined) switchMode(pi, ctx, picked);
    return;
  }
  const current = session(ctx.sessionManager).mode;
  guardNotify(ctx, `mode ${current} (${names.join(", ")})`);
}

function resolveInput(name: string): string {
  return getModeLayer(name) === undefined ? name.toLowerCase() : name;
}

export function restoreApprovalMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  const warn = guardWarn(ctx);
  replaceConfigModes(loadModesConfig(getAgentDir(), warn), warn);
  const persisted = readPersistedMode(ctx.sessionManager);
  const restored = resetSession(ctx.sessionManager);
  const configuredDefault = readDefaultMode();
  const result =
    persisted === undefined && configuredDefault !== undefined
      ? enterMode(ctx.sessionManager, configuredDefault, { persist: false })
      : restored;
  if (result.diagnostic !== undefined) warn(result.diagnostic);
  if (result.veto !== undefined) guardNotify(ctx, result.veto, "error");
  else {
    for (const notice of result.notices) {
      guardNotify(ctx, notice.text, notice.level);
    }
  }
  publishMode(pi, ctx.sessionManager);
  publishStatus(ctx);
}

export function registerBuiltins(): void {
  for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);
}

export function registerModeCommands(pi: ExtensionAPI): void {
  pi.registerCommand("mode", {
    description: "Show, pick, or switch the approval mode",
    getArgumentCompletions: (prefix: string) =>
      prefixCompletions(prefix.trim(), modeNames()),
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        await pickMode(pi, ctx);
        return;
      }
      const lower = raw.toLowerCase();
      if (lower === "ask" || lower === "autopilot") {
        const replacement = lower === "autopilot" ? "auto" : "manual";
        guardNotify(
          ctx,
          `"${raw}" is a legacy mode name; use "${replacement}" instead`,
          "error",
        );
        return;
      }
      const parts = raw.split(/\s+/);
      if (parts[0]?.toLowerCase() === "settings") {
        if (parts[1]?.toLowerCase() === "default") {
          setDefaultMode(pi, ctx, parts[2] ?? "");
          return;
        }
        guardNotify(ctx, "usage: /mode settings default <mode>", "error");
        return;
      }
      switchMode(pi, ctx, resolveInput(raw));
    },
  });

  pi.registerShortcut?.(Key.alt("m"), {
    description: "Cycle approval mode",
    handler: async (ctx) => {
      const names = modeNames();
      if (names.length === 0) return;
      const current = session(ctx.sessionManager).mode;
      const index = names.indexOf(current);
      const next = names[(index + 1) % names.length] ?? current;
      switchMode(pi, ctx, next);
    },
  });
}
