import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
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
  lines: () => string[];
  refresh: () => Promise<void>;
  start: (requestRender: () => void) => void;
  stop: () => void;
}

interface SectionController {
  lines: () => string[];
  refresh: () => Promise<void>;
  start: (requestRender: () => void) => void;
  stop: () => void;
}

function headerSection(
  ascii: string[],
  width: number,
  gap: number,
): SectionController {
  const fitted = () => {
    const lines = fitLines(ascii, width, "center");
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
  let requestRender: (() => void) | undefined;

  async function refresh(): Promise<void> {
    if (running) return;
    running = true;
    try {
      lines = splitOutput(await deps.run(command, args, undefined));
    } catch (error) {
      lines = [error instanceof Error ? error.message : String(error)];
      if (!warned) {
        warned = true;
        deps.notify(lines[0]);
      }
    } finally {
      running = false;
    }
    requestRender?.();
  }

  return {
    lines: () => {
      const fitted = fitLines(lines, width, "left");
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
    lines: () => sections.flatMap((section) => section.lines()),
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
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const loaded = loadConfig(getAgentDir());
    if (loaded.diagnostics.length > 0) {
      ctx.ui.notify(
        `pi-dashboard: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        "warning",
      );
    }
    const controller = createDashboard(loaded.config, {
      run: (command, args, signal) =>
        runCommand(command, args, ctx.cwd, signal),
      notify: (message) => ctx.ui.notify(message, "warning"),
    });
    ctx.ui.setHeader((tui, _theme) => {
      controller.start(() => tui.requestRender());
      void controller.refresh();
      return {
        dispose: () => controller.stop(),
        invalidate() {},
        render: (_width: number) => controller.lines(),
      };
    });
  });
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setHeader(undefined);
  });
}
