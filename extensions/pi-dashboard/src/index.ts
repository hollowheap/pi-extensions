import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Theme,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isPermissionError } from "@hollowheap/core/config";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import {
  getSessionSnapshot,
  subscribeSessionSnapshot,
} from "@hollowheap/core/snapshot";
import { effectiveCwd } from "@hollowheap/core/state";
import {
  type DashboardConfig,
  type DashboardSettings,
  loadConfig,
  saveDashboardSettings,
} from "./config.js";
import { runCommand } from "./exec.js";
import { fitLines, splitOutput } from "./render.js";
import {
  DEFAULT_DASHBOARD_ACTIONS,
  type StateRenderInput,
  renderActionsSection,
  renderSessionsSection,
  renderStateSection,
} from "./sections.js";
import { type DashboardSessionItem, loadRecentSessions } from "./sessions.js";
import { showDashboardSettings } from "./settings.js";
import { showDashboardOverlay } from "./view.js";

const IDENTITY_THEME = {
  fg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function resolveTheme(theme?: Partial<Theme>): Theme {
  if (
    theme &&
    typeof theme.fg === "function" &&
    typeof theme.bold === "function"
  ) {
    return theme as Theme;
  }
  return IDENTITY_THEME;
}

export interface DashboardDeps {
  run: (
    command: string,
    args: string[],
    signal: AbortSignal | undefined,
  ) => Promise<string>;
  notify: (message: string) => void;
  theme?: Partial<Theme>;
  snapshotOwner?: unknown;
  getStateInput?: () => Omit<StateRenderInput, "snapshot">;
  loadSessions?: (
    scope: "cwd" | "all",
    maxItems: number,
  ) => Promise<DashboardSessionItem[]>;
}

export interface DashboardController {
  lines: (renderWidth?: number, theme?: Partial<Theme>) => string[];
  refresh: () => Promise<void>;
  start: (requestRender: () => void) => void;
  stop: () => void;
}

interface SectionController {
  lines: (renderWidth?: number, theme?: Partial<Theme>) => string[];
  refresh: () => Promise<void>;
  start: (requestRender: () => void) => void;
  stop: () => void;
}

function appendGap(lines: string[], gap: number): string[] {
  for (let i = 0; i < gap; i++) lines.push("");
  return lines;
}

function headerSection(
  ascii: string[],
  width: number,
  align: "left" | "center" | undefined,
  gap: number,
): SectionController {
  return {
    lines: (renderWidth?: number) =>
      appendGap(fitLines(ascii, renderWidth ?? width, align ?? "center"), gap),
    refresh: () => Promise.resolve(),
    start: () => undefined,
    stop: () => undefined,
  };
}

function stateSection(
  width: number,
  align: "left" | "center" | undefined,
  gap: number,
  deps: DashboardDeps,
): SectionController {
  let unsubscribe: (() => void) | undefined;
  let stopped = false;

  return {
    lines: (renderWidth?: number, theme?: Partial<Theme>) => {
      const base = deps.getStateInput?.() ?? { cwd: process.cwd() };
      const snapshot = deps.snapshotOwner
        ? getSessionSnapshot(deps.snapshotOwner)
        : {};
      return appendGap(
        renderStateSection(
          { ...base, snapshot },
          resolveTheme(theme ?? deps.theme),
          renderWidth ?? width,
          align ?? "left",
        ),
        gap,
      );
    },
    refresh: () => Promise.resolve(),
    start: (requestRender: () => void) => {
      if (stopped || !deps.snapshotOwner || unsubscribe) return;
      unsubscribe = subscribeSessionSnapshot(deps.snapshotOwner, () => {
        if (!stopped) requestRender();
      });
    },
    stop: () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

function sessionsSection(
  maxItems: number,
  scope: "cwd" | "all",
  width: number,
  align: "left" | "center" | undefined,
  gap: number,
  deps: DashboardDeps,
): SectionController {
  let sessions: DashboardSessionItem[] = [];
  let running = false;
  let stopped = false;
  let requestRender: (() => void) | undefined;

  async function refresh(): Promise<void> {
    if (running || stopped || !deps.loadSessions) return;
    running = true;
    try {
      const loaded = await deps.loadSessions(scope, maxItems);
      if (!stopped) {
        sessions = loaded;
        requestRender?.();
      }
    } catch {
      // Keep prior list when session listing fails transiently.
    } finally {
      running = false;
    }
  }

  return {
    lines: (renderWidth?: number, theme?: Partial<Theme>) =>
      appendGap(
        renderSessionsSection(
          sessions,
          resolveTheme(theme ?? deps.theme),
          renderWidth ?? width,
          { maxItems },
          align ?? "left",
        ),
        gap,
      ),
    refresh,
    start: (renderRequest: () => void) => {
      if (!stopped) requestRender = renderRequest;
    },
    stop: () => {
      stopped = true;
    },
  };
}

function actionsSection(
  width: number,
  align: "left" | "center" | undefined,
  gap: number,
  deps: DashboardDeps,
): SectionController {
  return {
    lines: (renderWidth?: number, theme?: Partial<Theme>) =>
      appendGap(
        renderActionsSection(
          DEFAULT_DASHBOARD_ACTIONS,
          resolveTheme(theme ?? deps.theme),
          renderWidth ?? width,
          align ?? "left",
        ),
        gap,
      ),
    refresh: () => Promise.resolve(),
    start: () => undefined,
    stop: () => undefined,
  };
}

function terminalSection(
  command: string,
  args: string[],
  intervalMs: number,
  width: number,
  align: "left" | "center" | undefined,
  gap: number,
  deps: DashboardDeps,
): SectionController {
  let lines: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let warned = false;
  let stopped = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let requestRender: (() => void) | undefined;
  const controller = new AbortController();

  async function refresh(): Promise<void> {
    if (running || stopped) return;
    running = true;
    let aborted = false;
    try {
      const output = await deps.run(command, args, controller.signal);
      if (controller.signal.aborted || stopped) {
        aborted = true;
      } else {
        lines = splitOutput(output).map((line) =>
          sanitizeTerminalText(line, { allowSgr: true }),
        );
        retryCount = 0;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    } catch (error) {
      if (controller.signal.aborted || stopped) {
        aborted = true;
      } else {
        lines = [
          sanitizeTerminalText(
            error instanceof Error ? error.message : String(error),
          ),
        ];
        if (!warned) {
          warned = true;
          deps.notify(lines[0]);
        }
        if (retryCount < MAX_RETRIES && !stopped) {
          retryCount++;
          const delay = Math.min(1000 * 2 ** retryCount, 10000);
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (!stopped) void refresh();
          }, delay);
        }
      }
    } finally {
      running = false;
    }
    if (aborted || stopped) return;
    requestRender?.();
  }

  return {
    lines: (renderWidth?: number) => {
      const fitted = fitLines(lines, renderWidth ?? width, align ?? "left");
      return appendGap(fitted, gap);
    },
    refresh,
    start(renderRequest: () => void) {
      if (stopped) return;
      requestRender = renderRequest;
      if (timer !== undefined) return;
      timer = setInterval(() => void refresh(), intervalMs);
    },
    stop() {
      stopped = true;
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    },
  };
}

export function createDashboard(
  config: DashboardConfig,
  deps: DashboardDeps,
): DashboardController {
  const sections = config.sections.map((section) => {
    if (section.type === "header") {
      return headerSection(
        section.ascii,
        config.width,
        section.align,
        section.gap,
      );
    }
    if (section.type === "state") {
      return stateSection(config.width, section.align, section.gap, deps);
    }
    if (section.type === "sessions") {
      return sessionsSection(
        section.maxItems,
        section.scope,
        config.width,
        section.align,
        section.gap,
        deps,
      );
    }
    if (section.type === "actions") {
      return actionsSection(config.width, section.align, section.gap, deps);
    }
    return terminalSection(
      section.command,
      section.args,
      section.intervalMs,
      config.width,
      section.align,
      section.gap,
      deps,
    );
  });
  return {
    lines: (renderWidth?: number, theme?: Partial<Theme>) =>
      sections.flatMap((section) => section.lines(renderWidth, theme)),
    refresh: async () => {
      await Promise.all(sections.map((section) => section.refresh()));
    },
    start: (requestRender) => {
      for (const section of sections) section.start(requestRender);
    },
    stop: () => {
      for (const section of sections) section.stop();
    },
  };
}

function hasConversationStarted(ctx: ExtensionContext): boolean {
  const getBranch = (ctx.sessionManager as { getBranch?: () => unknown[] })
    ?.getBranch;
  if (typeof getBranch !== "function") return false;
  return getBranch
    .call(ctx.sessionManager)
    .some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === "message",
    );
}

export default function (pi: ExtensionAPI) {
  let active: DashboardController | undefined;
  let currentConfig: DashboardConfig | undefined;
  let hidden = false;

  const makeStateInput = (
    ctx: ExtensionContext,
  ): Omit<StateRenderInput, "snapshot"> => ({
    cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
    model: ctx.model?.id,
    thinking: ctx.thinkingLevel,
  });

  const loadForCtx = (
    ctx: ExtensionContext,
    scope: "cwd" | "all",
    limit = 5,
  ): Promise<DashboardSessionItem[]> => {
    const sm = ctx.sessionManager as {
      getSessionDir?: () => string;
      getSessionId?: () => string;
    };
    return loadRecentSessions({
      cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
      sessionDir:
        typeof sm.getSessionDir === "function" ? sm.getSessionDir() : undefined,
      currentSessionId:
        typeof sm.getSessionId === "function" ? sm.getSessionId() : undefined,
      limit,
      scope,
    });
  };

  const hideHeader = (ctx: ExtensionContext) => {
    hidden = true;
    active?.stop();
    active = undefined;
    // Empty component suppresses builtInHeader without leaving startup lines in chat.
    ctx.ui.setHeader(() => ({
      dispose() {},
      invalidate() {},
      render: () => [],
    }));
  };

  const install = (ctx: ExtensionContext, config: DashboardConfig) => {
    active?.stop();
    currentConfig = config;
    if ((config.autoHide ?? true) && hasConversationStarted(ctx)) {
      hideHeader(ctx);
      return;
    }
    hidden = false;
    const controller = createDashboard(config, {
      run: (command, args, signal) =>
        runCommand(
          command,
          args,
          effectiveCwd(ctx.cwd, ctx.sessionManager),
          signal,
        ),
      notify: (message) => ctx.ui.notify(message, "warning"),
      snapshotOwner: ctx.sessionManager,
      getStateInput: () => makeStateInput(ctx),
      loadSessions: (scope, maxItems) => loadForCtx(ctx, scope, maxItems),
    });
    active = controller;
    ctx.ui.setHeader((tui, theme) => {
      controller.start(() => tui.requestRender());
      void controller.refresh();
      return {
        dispose: () => controller.stop(),
        invalidate() {},
        render: (width: number) => controller.lines(width, theme),
      };
    });
  };

  const openSettings = async (ctx: ExtensionContext) => {
    const agentDir = getAgentDir();
    const loaded = loadConfig(agentDir);
    if (loaded.diagnostics.length > 0 && ctx.hasUI) {
      const hasPerm = loaded.diagnostics.some((diagnostic) =>
        isPermissionError(diagnostic),
      );
      ctx.ui.notify(
        `pi-dashboard: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        hasPerm ? "error" : "warning",
      );
    }
    const config = currentConfig ?? loaded.config;
    await showDashboardSettings(ctx, config, (settings: DashboardSettings) => {
      try {
        saveDashboardSettings(agentDir, settings);
        const next = loadConfig(agentDir);
        currentConfig = next.config;
        if (ctx.mode === "tui") install(ctx, next.config);
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `pi-dashboard: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      }
    });
  };

  const openOverlay = async (ctx: ExtensionCommandContext) => {
    const config = currentConfig ?? loadConfig(getAgentDir()).config;
    const sessionsConfig = config.sections.find(
      (section) => section.type === "sessions",
    );
    const scope =
      sessionsConfig?.type === "sessions" ? sessionsConfig.scope : "cwd";
    const maxItems =
      sessionsConfig?.type === "sessions"
        ? Math.max(1, Math.min(20, sessionsConfig.maxItems))
        : 8;
    const initialSessions = await loadForCtx(ctx, scope, maxItems);
    const result = await showDashboardOverlay(ctx, {
      initialSessions,
      initialScope: scope,
      maxItems,
      loadSessions: (nextScope) => loadForCtx(ctx, nextScope, maxItems),
      getStateInput: () => makeStateInput(ctx),
      snapshotOwner: ctx.sessionManager,
    });
    if (result.type === "settings") {
      await openSettings(ctx);
    } else if (result.type === "resume") {
      await ctx.switchSession(result.session.path);
    } else if (result.type === "command") {
      pi.sendUserMessage(result.command, { expandPromptTemplates: true });
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const loaded = loadConfig(getAgentDir());
    if (loaded.diagnostics.length > 0) {
      const hasPerm = loaded.diagnostics.some((diagnostic) =>
        isPermissionError(diagnostic),
      );
      ctx.ui.notify(
        `pi-dashboard: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        hasPerm ? "error" : "warning",
      );
    }
    install(ctx, loaded.config);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    if ((currentConfig?.autoHide ?? true) && !hidden) {
      hideHeader(ctx);
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const config = currentConfig ?? loadConfig(getAgentDir()).config;
    install(ctx, config);
  });

  pi.registerCommand("dashboard", {
    description:
      "Open interactive dashboard (or '/dashboard settings' / '/dashboard config' to configure)",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length > 1) return null;
      const query = (parts[0] ?? "").toLowerCase();
      return ["settings", "config"]
        .filter((action) => action.startsWith(query))
        .map((action) => ({
          value: action,
          label: action,
          description: "open dashboard settings",
        }));
    },
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const subcommand = args.trim().toLowerCase();
      if (subcommand === "settings" || subcommand === "config") {
        await openSettings(ctx);
        return;
      }
      await openOverlay(ctx);
    },
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active?.stop();
    active = undefined;
    hidden = false;
    ctx.ui.setHeader(undefined);
  });
}
