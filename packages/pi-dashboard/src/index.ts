import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { effectiveCwd } from "@hollowheap/core";
import { type DashboardConfig, loadConfig } from "./config.js";
import { runCommand } from "./exec.js";
import { fitLines, splitOutput } from "./render.js";

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
  gap: number,
  deps: DashboardDeps,
): SectionController {
  let lines: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let warned = false;
  let stopped = false;
  let requestRender: (() => void) | undefined;
  const controller = new AbortController();

  async function refresh(): Promise<void> {
    if (running) return;
    running = true;
    let aborted = false;
    try {
      lines = splitOutput(await deps.run(command, args, controller.signal));
    } catch (error) {
      if (controller.signal.aborted) {
        aborted = true;
      } else {
        lines = [error instanceof Error ? error.message : String(error)];
        if (!warned) {
          warned = true;
          deps.notify(lines[0]);
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
      const fitted = fitLines(lines, renderWidth ?? width, "left");
      for (let i = 0; i < gap; i++) fitted.push("");
      return fitted;
    },
    refresh,
    start(renderRequest: () => void) {
      requestRender = renderRequest;
      if (timer !== undefined) return;
      timer = setInterval(() => void refresh(), intervalMs);
    },
    stop() {
      stopped = true;
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}

export function createDashboard(
  config: DashboardConfig,
  deps: DashboardDeps,
): DashboardController {
  const sections = config.sections.map((section) =>
    section.type === "header"
      ? headerSection(section.ascii, config.width, section.gap)
      : terminalSection(
          section.command,
          section.args,
          section.intervalMs,
          config.width,
          section.gap,
          deps,
        ),
  );
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
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    active?.stop();
    const loaded = loadConfig(getAgentDir());
    if (loaded.diagnostics.length > 0) {
      ctx.ui.notify(
        `pi-dashboard: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        "warning",
      );
    }
    const controller = createDashboard(loaded.config, {
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
  });
  pi.on("session_shutdown", (_event, ctx) => {
    active?.stop();
    active = undefined;
    ctx.ui.setHeader(undefined);
  });
}
