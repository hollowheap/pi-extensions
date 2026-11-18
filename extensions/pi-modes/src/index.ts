import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { loadModesConfig, updateJsonConfig } from "@hollowheap/core/config";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import {
  enterMode,
  getModeLayer,
  modeNames,
  registerMode,
  replaceConfigModes,
  resetSession,
} from "@hollowheap/core/modes";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { readPersistedMode, session, setMode } from "@hollowheap/core/state";
import type { ModeLayer } from "@hollowheap/core/types";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { getActiveTuiConfig } from "@hollowheap/tui/state";

export const AUTO_MODE: ModeLayer = Object.freeze({
  name: "auto",
  description: "Writes and non-destructive bash run without asking",
  defaults: Object.freeze({
    read: "allow" as const,
    search: "allow" as const,
    edit: "allow" as const,
    shell: "allow" as const,
    external: "allow" as const,
  }),
  onEnter: () => ({
    notice: {
      text: "auto on: writes and non-destructive bash run without asking",
      level: "warning" as const,
    },
  }),
});

function publishMode(pi: ExtensionAPI, owner: unknown): void {
  const mode = session(owner).mode;
  updateSessionSnapshot(owner, "mode", { name: mode, updatedAt: Date.now() });
  pi.events?.emit?.("mode:changed", { mode });
}

function publishStatus(ctx: ExtensionContext): void {
  const ui = ctx.ui as unknown as {
    setStatus?: (key: string, value: string | undefined) => void;
  };
  if (typeof ui.setStatus !== "function") return;
  const config = getActiveTuiConfig() as unknown as {
    modeIndicator?: boolean;
  };
  const visible = config.modeIndicator !== false;
  ui.setStatus("mode", visible ? session(ctx.sessionManager).mode : undefined);
}

function getModesConfigPath(): string {
  return join(getAgentDir(), "modes.json");
}

function readModesDocument(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(getModesConfigPath(), "utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function readConfiguredDefault(): string | undefined {
  const value = readModesDocument().default;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isKnownMode(name: string): boolean {
  if (getModeLayer(name) !== undefined) return true;
  const modes = readModesDocument().modes;
  if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
    return false;
  }
  return Object.hasOwn(modes, name);
}

async function setDefaultMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): Promise<void> {
  if (name === "" || !isKnownMode(name)) {
    ctx.ui.notify(`pi-modes: unknown mode "${name}"`, "error");
    return;
  }
  const result = updateJsonConfig(getModesConfigPath(), (root) => {
    root.default = name;
  });
  if (!result.ok) {
    ctx.ui.notify(`pi-modes: ${sanitizeTerminalText(result.error)}`, "error");
    return;
  }
  ctx.ui.notify(`pi-modes: default mode ${name}`);
  publishMode(pi, ctx.sessionManager);
}

async function switchMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  raw: string,
): Promise<void> {
  const result = enterMode(ctx.sessionManager, raw);
  if (result.diagnostic !== undefined) {
    ctx.ui.notify(
      `pi-modes: ${sanitizeTerminalText(result.diagnostic)}`,
      "error",
    );
    return;
  }
  if (result.veto !== undefined) {
    ctx.ui.notify(`pi-modes: ${sanitizeTerminalText(result.veto)}`, "error");
    return;
  }
  if (result.notices.length > 0) {
    for (const notice of result.notices) {
      ctx.ui.notify(
        `pi-modes: ${sanitizeTerminalText(notice.text)}`,
        notice.level,
      );
    }
  } else {
    ctx.ui.notify(`pi-modes: mode ${sanitizeTerminalText(result.mode)}`);
  }
  publishMode(pi, ctx.sessionManager);
  publishStatus(ctx);
}

async function pickMode(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const names = modeNames();
  if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
    const { showFuzzyPicker } = await import("@hollowheap/tui/picker");
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
    if (picked !== undefined) await switchMode(pi, ctx, picked);
    return;
  }
  const current = sanitizeTerminalText(session(ctx.sessionManager).mode);
  ctx.ui?.notify?.(
    `pi-modes: mode ${current} (${sanitizeTerminalText(names.join(", "))})`,
  );
}

function resolveInput(name: string): string {
  return getModeLayer(name) === undefined ? name.toLowerCase() : name;
}

export default function (pi: ExtensionAPI): void {
  for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);
  registerMode(AUTO_MODE);

  const restore = (ctx: ExtensionContext): void => {
    const notify = (message: string) =>
      ctx.ui.notify(`pi-modes: ${sanitizeTerminalText(message)}`, "warning");
    replaceConfigModes(loadModesConfig(getAgentDir(), notify), notify);
    const persisted = readPersistedMode(ctx.sessionManager);
    const restored = resetSession(ctx.sessionManager);
    if (restored.diagnostic !== undefined) {
      ctx.ui.notify(
        `pi-modes: ${sanitizeTerminalText(restored.diagnostic)}`,
        "warning",
      );
    }
    if (restored.veto !== undefined) {
      ctx.ui.notify(
        `pi-modes: ${sanitizeTerminalText(restored.veto)}`,
        "error",
      );
    }
    const configuredDefault = readConfiguredDefault();
    if (
      persisted === undefined &&
      configuredDefault !== undefined &&
      getModeLayer(configuredDefault) !== undefined
    ) {
      setMode(ctx.sessionManager, configuredDefault, { persist: false });
    }
    publishMode(pi, ctx.sessionManager);
    publishStatus(ctx);
  };

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));

  pi.registerCommand("mode", {
    description: "Show, pick, or switch the approval mode",
    getArgumentCompletions: (prefix: string) => {
      const lower = prefix.trim().toLowerCase();
      return modeNames()
        .filter((mode) => mode.toLowerCase().startsWith(lower))
        .map((mode) => ({ value: mode, label: mode }));
    },
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        await pickMode(pi, ctx);
        return;
      }
      const lower = raw.toLowerCase();
      if (lower === "ask" || lower === "autopilot") {
        ctx.ui.notify(
          `pi-modes: "${raw}" is a legacy mode name; use "manual" instead`,
          "error",
        );
        return;
      }
      const parts = raw.split(/\s+/);
      if (parts[0]?.toLowerCase() === "settings") {
        if (parts[1]?.toLowerCase() === "default") {
          await setDefaultMode(pi, ctx, parts[2] ?? "");
          return;
        }
        ctx.ui.notify(
          "pi-modes: usage: /mode settings default <mode>",
          "error",
        );
        return;
      }
      await switchMode(pi, ctx, resolveInput(raw));
    },
  });

  pi.registerShortcut(Key.alt("m"), {
    description: "Cycle approval mode",
    handler: async (ctx) => {
      const names = modeNames();
      if (names.length === 0) return;
      const current = session(ctx.sessionManager).mode;
      const index = names.indexOf(current);
      const next = names[(index + 1) % names.length] ?? current;
      await switchMode(pi, ctx, next);
    },
  });
}
