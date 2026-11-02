import {
  type ExtensionAPI,
  VERSION,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { effectiveCwd } from "@hollowheap/core";
import {
  type DashboardConfig,
  type DashboardSettings,
  loadConfig,
  saveDashboardSettings,
} from "./config.js";
import { runCommand } from "./exec.js";
import { fitLines, splitOutput } from "./render.js";
import { showDashboardSettings } from "./settings.js";

export interface DashboardDeps {
  run: (
    command: string,
    args: string[],
    signal: AbortSignal | undefined,
  ) => Promise<string>;
  notify: (message: string) => void;
}

export interface DashboardController {
  lines: (renderWidth?: number) => string[];
  refresh: () => Promise<void>;
  start: (requestRender: () => void) => void;
  stop: () => void;
}

interface SectionController {
  lines: (renderWidth?: number) => string[];
  refresh: () => Promise<void>;
  start: (requestRender: () => void) => void;
  stop: () => void;
}

function headerSection(
  ascii: string[],
  width: number,
  gap: number,
): SectionController {
  const fitted = (renderWidth?: number) => {
    const lines = fitLines(ascii, renderWidth ?? width, "center");
    for (let i = 0; i < gap; i++) lines.push("");
    return lines;
  };
  return {
    lines: fitted,
    refresh: () => Promise.resolve(),
    start: (_requestRender: () => void) => undefined,
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
        lines = splitOutput(output);
        retryCount = 0;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    } catch (error) {
      if (controller.signal.aborted || stopped) {
        aborted = true;
      } else {
        lines = [error instanceof Error ? error.message : String(error)];
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
      for (let i = 0; i < gap; i++) fitted.push("");
      return fitted;
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
      return headerSection(section.ascii, config.width, section.gap);
    }
    if (section.type === "version") {
      return headerSection([`Pi v${VERSION}`], config.width, section.gap);
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
    lines: (renderWidth?: number) =>
      sections.flatMap((section) => section.lines(renderWidth)),
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

export default function (pi: ExtensionAPI) {
  let active: DashboardController | undefined;

  const install = (
    ctx: Parameters<NonNullable<Parameters<ExtensionAPI["on"]>[1]>>[1],
    config: DashboardConfig,
  ) => {
    active?.stop();
    const controller = createDashboard(config, {
      run: (command, args, signal) =>
        runCommand(
          command,
          args,
          effectiveCwd(ctx.cwd, ctx.sessionManager),
          signal,
        ),
      notify: (message) => ctx.ui.notify(message, "warning"),
    });
    active = controller;
    ctx.ui.setHeader((tui, _theme) => {
      controller.start(() => tui.requestRender());
      void controller.refresh();
      return {
        dispose: () => controller.stop(),
        invalidate() {},
        render: (width: number) => controller.lines(width),
      };
    });
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const loaded = loadConfig(getAgentDir());
    if (loaded.diagnostics.length > 0) {
      ctx.ui.notify(
        `pi-dashboard: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        "warning",
      );
    }
    install(ctx, loaded.config);
  });
  pi.registerCommand("dashboard", {
    description: "Dashboard settings: startup header and header gap",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
        if (ctx.hasUI) {
          ctx.ui.notify("Dashboard settings require TUI mode.", "info");
        }
        return;
      }
      const loaded = loadConfig(getAgentDir());
      let pending: DashboardSettings | undefined;
      await showDashboardSettings(ctx, loaded.config, (settings) => {
        pending = settings;
      });
      if (pending === undefined) return;
      try {
        saveDashboardSettings(getAgentDir(), pending);
        install(ctx, loadConfig(getAgentDir()).config);
        ctx.ui.notify("Dashboard settings saved", "info");
      } catch (error) {
        ctx.ui.notify(
          `pi-dashboard: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });
  pi.on("session_shutdown", (_event, ctx) => {
    active?.stop();
    active = undefined;
    ctx.ui.setHeader(undefined);
  });
}
