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

export function createDashboard(
  config: DashboardConfig,
  deps: DashboardDeps,
): DashboardController {
  let lines: string[] =
    config.source.kind === "ascii" ? [...config.source.lines] : [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let warned = false;
  let requestRender: (() => void) | undefined;

  async function refresh(): Promise<void> {
    if (config.source.kind !== "command" || running) return;
    running = true;
    try {
      lines = splitOutput(
        await deps.run(config.source.command, config.source.args, undefined),
      );
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
    lines: () => fitLines(lines, config.width),
    refresh,
    start(renderRequest: () => void) {
      requestRender = renderRequest;
      if (config.source.kind !== "command" || timer !== undefined) return;
      timer = setInterval(() => void refresh(), config.intervalMs);
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
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
