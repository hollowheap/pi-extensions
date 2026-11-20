import { contentText } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { toolOutputDisplay } from "@hollowheap/ui/tool-output";

type ToolRenderContext = Parameters<
  NonNullable<ToolRenderers["renderCall"]>
>[2];
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import {
  type CustomToolVerb,
  DEFAULT_TUI_CONFIG,
  type LoadingIndicatorStyle,
  type OverlaySurfaceMode,
  type PanelConfig,
  type ToolVerbPack,
  type ToolVerbosity,
  type TuiConfig,
} from "@hollowheap/core/tui-config";
import {
  type PanelStateToken,
  framePanelLines,
  isPanelSurfaceActive,
  resolvePanelFrameLayout,
} from "@hollowheap/ui/frame";
import { createWorkingIndicator } from "@hollowheap/ui/spinner";
import { getActiveTuiConfig } from "@hollowheap/ui/state";
export {
  type PanelFrameLayout,
  type PanelStateToken,
  framePanelLines,
  getPanelInnerWidth,
  isPanelSurfaceActive,
  resolvePanelFrameLayout,
} from "@hollowheap/ui/frame";
export { stripBackgroundSgr } from "@hollowheap/ui/surface";

const FALLBACK_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
const FALLBACK_SPINNER_INTERVAL_MS = 80;
const FALLBACK_RESULT_PREVIEW_LINES = 10;
const MAX_SPINNER_TIMER_MS = 10 * 60_000;

const VERB_PACKS: Readonly<
  Record<ToolVerbPack, Readonly<Record<string, CustomToolVerb>>>
> = {
  standard: {
    read: { active: "Reading...", settled: "Read" },
    edit: { active: "Editing...", settled: "Edited" },
    write: { active: "Writing...", settled: "Wrote" },
    bash: { active: "Running...", settled: "Ran" },
    grep: { active: "Searching...", settled: "Searched" },
    find: { active: "Finding...", settled: "Found" },
    ls: { active: "Listing...", settled: "Listed" },
    web_search: { active: "Searching web...", settled: "Searched web" },
    fetch_url: { active: "Fetching...", settled: "Fetched" },
    codemode: { active: "Executing...", settled: "Executed" },
    prompt: { active: "Prompting...", settled: "Prompted" },
    steer: { active: "Steering...", settled: "Steered" },
  },
  terse: {
    read: { active: "read...", settled: "read" },
    edit: { active: "edit...", settled: "edit" },
    write: { active: "write...", settled: "write" },
    bash: { active: "bash...", settled: "bash" },
    grep: { active: "grep...", settled: "grep" },
    find: { active: "find...", settled: "find" },
    ls: { active: "ls...", settled: "ls" },
    web_search: { active: "search...", settled: "search" },
    fetch_url: { active: "fetch...", settled: "fetch" },
    codemode: { active: "code...", settled: "code" },
    prompt: { active: "prompt...", settled: "prompt" },
    steer: { active: "steer...", settled: "steer" },
  },
  playful: {
    read: { active: "Perusing...", settled: "Perused" },
    edit: { active: "Sculpting...", settled: "Sculpted" },
    write: { active: "Inscribing...", settled: "Inscribed" },
    bash: { active: "Conjuring...", settled: "Conjured" },
    grep: { active: "Hunting...", settled: "Hunted" },
    find: { active: "Seeking...", settled: "Sought" },
    ls: { active: "Surveying...", settled: "Surveyed" },
    web_search: { active: "Foraging...", settled: "Foraged" },
    fetch_url: { active: "Reeling in...", settled: "Reeled in" },
    codemode: { active: "Weaving...", settled: "Woven" },
    prompt: { active: "Asking...", settled: "Asked" },
    steer: { active: "Nudging...", settled: "Nudged" },
  },
};

function formatUnknownToolName(toolName: string): string {
  const cleaned = toolName.replace(/[_-]+/g, " ").trim() || toolName;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export type PanelRenderConfig = PanelConfig & {
  verbPack: ToolVerbPack;
  surface?: OverlaySurfaceMode;
  toolVerbosity?: ToolVerbosity;
};

export function panelRenderConfig(config: TuiConfig): PanelRenderConfig {
  const { panel, borderStyle, overlaySurface, toolVerbosity, verbPack } =
    config;
  return {
    ...panel,
    borderStyle:
      panel.style !== undefined ||
      panel.borderStyle !== DEFAULT_TUI_CONFIG.panel.borderStyle
        ? panel.borderStyle
        : borderStyle,
    verbPack,
    toolVerbosity,
    surface:
      panel.style === undefined && panel.surface === "transparent"
        ? overlaySurface
        : (panel.surface ?? overlaySurface),
  };
}

const ESC = String.fromCharCode(27);
const CODEMODE_NESTED_CALL_RE = new RegExp(
  `^((?:${ESC}\\[[0-9;:]*m|\\s)*(?:[✓✗•▸▪\\-*]|\\.\\.\\.)(?:${ESC}\\[[0-9;:]*m|\\s)+)([a-z][a-z0-9_-]*)(?=(?:${ESC}\\[[0-9;:]*m)*[\\s(:]|$)`,
);

function applyCodemodeVerbPack(
  lines: readonly string[],
  cfg: PanelRenderConfig,
): string[] {
  if (cfg.toolVerbosity === "low") return [...lines];
  const pack = VERB_PACKS[cfg.verbPack] ?? VERB_PACKS.standard;
  return lines.map((line) =>
    line.replace(
      CODEMODE_NESTED_CALL_RE,
      (match, prefix: string, nestedTool: string) => {
        const isKnown =
          Object.hasOwn(pack, nestedTool) ||
          Boolean(
            cfg.customVerbs && Object.hasOwn(cfg.customVerbs, nestedTool),
          );
        if (!isKnown) return match;
        const verb = resolveToolVerb(nestedTool, cfg);
        const label = prefix.includes("...") ? verb.active : verb.settled;
        return `${prefix}${label}`;
      },
    ),
  );
}

/** Resolve active/settled verb labels for a tool using custom overrides, packs, or fallback. */
export function resolveToolVerb(
  toolName: string,
  config: Pick<PanelRenderConfig, "verbPack" | "customVerbs">,
): CustomToolVerb {
  const custom =
    config.customVerbs && Object.hasOwn(config.customVerbs, toolName)
      ? config.customVerbs[toolName]
      : undefined;
  if (custom) return custom;
  const pack = VERB_PACKS[config.verbPack] ?? VERB_PACKS.standard;
  const known = Object.hasOwn(pack, toolName) ? pack[toolName] : undefined;
  if (known) return known;
  const formatted = formatUnknownToolName(toolName);
  if (config.verbPack === "terse") {
    const lower = formatted.toLowerCase();
    return { active: `${lower}...`, settled: lower };
  }
  return { active: `${formatted}ing...`, settled: `${formatted}ed` };
}

/** Format execution duration cleanly for outcome badges. */
export function formatToolDuration(
  durationMs: number | undefined,
): string | undefined {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return undefined;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** Extract a concise single-line target summary from tool call arguments. */
export function formatToolCallSummary(
  toolName: string,
  args: unknown,
): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const pick = (key: string): string | undefined => {
    const val = record[key];
    return typeof val === "string" && val.trim() !== ""
      ? val.replace(/\s+/g, " ").trim()
      : undefined;
  };
  if (toolName === "codemode") return undefined;
  if (toolName === "bash") return pick("command");
  if (toolName === "web_search") return pick("query");
  if (toolName === "fetch_url") return pick("url");
  if (toolName === "read") {
    const filePath = pick("file_path") ?? pick("path");
    if (!filePath) return undefined;
    const offset =
      typeof record.offset === "number" && Number.isFinite(record.offset)
        ? Math.trunc(record.offset)
        : undefined;
    const limit =
      typeof record.limit === "number" && Number.isFinite(record.limit)
        ? Math.trunc(record.limit)
        : undefined;
    if (offset !== undefined && limit !== undefined) {
      return `${filePath}:${offset}-${offset + limit - 1}`;
    }
    if (offset !== undefined) return `${filePath}:${offset}`;
    return filePath;
  }
  const pattern = pick("pattern");
  const path = pick("path") ?? pick("file_path");
  if (pattern && path) return `${pattern} in ${path}`;
  return path ?? pattern ?? pick("command") ?? pick("query") ?? pick("url");
}

interface PanelState {
  hasCall?: boolean;
  hasCallLines?: boolean;
  resultCalled?: boolean;
  resultIsError?: boolean;
  startedAt?: number;
  spinnerTheme?: unknown;
  spinnerKey?: string;
  spinner?: { frames: string[]; intervalMs: number };
  spinnerTimer?: ReturnType<typeof setInterval>;
  spinnerTimerInterval?: number;
  settled?: boolean;
  lockedSpinnerFrame?: string;
  innerCallComponent?: Component;
  innerResultComponent?: Component;
  renderResultLines?: (innerWidth: number) => string[];
  resultInvalidate?: () => void;
  cachedResult?: { width: number; lines: string[] };
  cachedCallRender?: { key: string; lines: string[] };
  cachedResultRender?: { key: string; lines: string[] };
}

function getConfigCacheKey(
  cfg: PanelConfig,
  ui: { colored: boolean; loadingIndicator: LoadingIndicatorStyle },
): string {
  return `${JSON.stringify(cfg)}:${ui.colored}:${ui.loadingIndicator}`;
}

function isResultError(result: {
  isError?: boolean;
  details?: unknown;
}): boolean {
  if (result.isError) return true;
  return (
    typeof result.details === "object" &&
    result.details !== null &&
    typeof (result.details as { error?: unknown }).error === "string"
  );
}

const PANEL_STATES = new WeakMap<object, PanelState>();

function getPanelState(context: ToolRenderContext | undefined): PanelState {
  if (context && typeof context.state === "object" && context.state !== null) {
    let existing = PANEL_STATES.get(context.state);
    if (!existing) {
      existing = {};
      PANEL_STATES.set(context.state, existing);
    }
    return existing;
  }
  return {};
}

function isBlankRenderedLine(line: string): boolean {
  return sanitizeTerminalText(line).trim() === "";
}

function trimEdgeBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankRenderedLine(lines[start] ?? "")) {
    start += 1;
  }
  while (end > start && isBlankRenderedLine(lines[end - 1] ?? "")) {
    end -= 1;
  }
  return lines.slice(start, end);
}

const REDUNDANT_HEADER_TOOLS = new Set([
  "bash",
  "codemode",
  "edit",
  "find",
  "grep",
  "ls",
  "powershell",
  "read",
  "write",
]);

function normalizeInnerCallLines(
  toolName: string,
  lines: readonly string[],
): string[] {
  const trimmed = trimEdgeBlankLines(lines);
  if (trimmed.length === 0 || !REDUNDANT_HEADER_TOOLS.has(toolName)) {
    return trimmed;
  }
  const firstPlain = sanitizeTerminalText(trimmed[0] ?? "").trim();
  const isRedundant =
    firstPlain.toLowerCase() === toolName.toLowerCase() ||
    firstPlain.toLowerCase().startsWith(`${toolName.toLowerCase()} `) ||
    ((toolName === "bash" || toolName === "powershell") &&
      firstPlain.startsWith("$ "));
  if (!isRedundant) {
    return trimmed;
  }
  return trimEdgeBlankLines(trimmed.slice(1));
}

function fg(
  theme: Theme | undefined,
  token: string,
  value: string,
  colored = true,
): string {
  return colored && typeof theme?.fg === "function"
    ? theme.fg(token as never, value)
    : value;
}

function bold(theme: Theme | undefined, value: string): string {
  return typeof theme?.bold === "function" ? theme.bold(value) : value;
}

function extractResultText(result: AgentToolResult<unknown>): string {
  if (!Array.isArray(result.content)) return "";
  const validBlocks = result.content.filter(
    (block): block is (typeof result.content)[number] =>
      typeof block === "object" && block !== null,
  );
  return validBlocks.length > 0 ? contentText(validBlocks) : "";
}

function renderFallbackResultLines(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme | undefined,
  colored = true,
  surfaceActive = false,
): string[] {
  const output = extractResultText(result);
  if (!output) return [];
  const rawLines = output.split("\n");
  const visible = options.expanded
    ? rawLines
    : rawLines.slice(0, FALLBACK_RESULT_PREVIEW_LINES);
  const lines = visible.map((line) =>
    fg(theme, "toolOutput", sanitizeTerminalText(line), colored),
  );
  const remaining = rawLines.length - visible.length;
  if (remaining > 0) {
    lines.push(
      fg(
        theme,
        surfaceActive ? "text" : "muted",
        `... (${remaining} more lines)`,
        colored,
      ),
    );
  }
  return lines;
}

interface SpinnerFrame {
  frame: string;
  tick: number;
  intervalMs: number;
}

function getSpinnerFrame(
  panelState: PanelState,
  theme: Theme | undefined,
  nowMs: number,
  style: LoadingIndicatorStyle,
  colored: boolean,
): SpinnerFrame {
  if (panelState.startedAt === undefined) {
    panelState.startedAt = nowMs;
  }
  const startedAt = panelState.startedAt;
  const elapsed = Math.max(0, nowMs - startedAt);
  const key = `${style}:${colored}`;
  if (
    panelState.spinnerTheme !== theme ||
    panelState.spinnerKey !== key ||
    panelState.spinner === undefined
  ) {
    panelState.spinnerTheme = theme;
    panelState.spinnerKey = key;
    panelState.spinner = createWorkingIndicator(style, theme, colored) ?? {
      frames: [...FALLBACK_SPINNER_FRAMES],
      intervalMs: FALLBACK_SPINNER_INTERVAL_MS,
    };
  }
  const { frames, intervalMs } = panelState.spinner;
  if (frames.length === 0) return { frame: "", tick: 0, intervalMs };
  const tick = Math.floor(elapsed / intervalMs);
  const idx = tick % frames.length;
  const rawFrame = frames[idx] ?? frames[0] ?? "";
  const frame =
    style === "host" ? fg(theme, "accent", rawFrame, colored) : rawFrame;
  return { frame, tick, intervalMs };
}

function startSpinnerTimer(
  panelState: PanelState,
  intervalMs: number,
  onTick: () => void,
): void {
  if (
    panelState.spinnerTimer !== undefined &&
    panelState.spinnerTimerInterval === intervalMs
  ) {
    return;
  }
  stopSpinnerTimer(panelState);
  panelState.spinnerTimerInterval = intervalMs;
  panelState.spinnerTimer = setInterval(onTick, intervalMs);
  panelState.spinnerTimer.unref?.();
}

function stopSpinnerTimer(panelState: PanelState): void {
  if (panelState.spinnerTimer !== undefined) {
    clearInterval(panelState.spinnerTimer);
    panelState.spinnerTimer = undefined;
    panelState.spinnerTimerInterval = undefined;
  }
}

export interface WrapToolRendererOptions {
  now?: () => number;
  requestRender?: () => void;
  getUiOptions?: () => {
    colored: boolean;
    loadingIndicator: LoadingIndicatorStyle;
  };
}

/** Wrap a tool's renderers with configurable panel framing, verbs, spinner, and badges. */
export function wrapToolRenderer(
  toolName: string,
  base: ToolRenderers | undefined,
  getConfig: () => PanelRenderConfig,
  wrapOptions?: WrapToolRendererOptions,
): ToolRenderers {
  const now = wrapOptions?.now ?? Date.now;
  const requestRender = wrapOptions?.requestRender;
  const getUi =
    wrapOptions?.getUiOptions ??
    (() => {
      const active = getActiveTuiConfig();
      return {
        colored: active.colored,
        loadingIndicator: active.loadingIndicator,
      };
    });

  return {
    renderShell: "self",
    renderCall(args, theme, context): Component & { dispose?: () => void } {
      const effectiveContext =
        toolName === "codemode" ? { ...context, expanded: true } : context;
      if (!getConfig().enabled && base?.renderCall) {
        return base.renderCall(args, theme, effectiveContext);
      }
      const panelState = getPanelState(context);
      panelState.hasCall = true;
      panelState.resultCalled = false;
      panelState.renderResultLines = undefined;
      panelState.resultInvalidate = undefined;
      panelState.cachedResult = undefined;
      panelState.cachedCallRender = undefined;
      panelState.cachedResultRender = undefined;
      panelState.startedAt ??= now();

      const innerCallContext: ToolRenderContext = {
        ...effectiveContext,
        outputPad: 0,
        lastComponent: context.lastComponent
          ? panelState.innerCallComponent
          : undefined,
      };
      let innerCall: Component | undefined;
      if (base?.renderCall) {
        try {
          innerCall = base.renderCall(args, theme, innerCallContext);
          panelState.innerCallComponent = innerCall;
        } catch {
          panelState.innerCallComponent = undefined;
          innerCall = undefined;
        }
      } else {
        panelState.innerCallComponent = undefined;
      }

      const component: Component & { dispose?: () => void } = {
        invalidate(): void {
          panelState.cachedResult = undefined;
          panelState.cachedCallRender = undefined;
          panelState.cachedResultRender = undefined;
          innerCall?.invalidate?.();
        },
        render(width: number): string[] {
          const cfg = getConfig();
          const ui = getUi();
          const settled = !context.isPartial;
          const spinner = getSpinnerFrame(
            panelState,
            theme,
            now(),
            ui.loadingIndicator,
            ui.colored,
          );
          const frameTick = !settled && cfg.reuseSpinner ? spinner.tick : -1;
          const cacheKey = `${width}:${getConfigCacheKey(cfg, ui)}:${frameTick}`;
          if (panelState.cachedCallRender?.key === cacheKey) {
            return panelState.cachedCallRender.lines;
          }

          panelState.settled = settled;
          if (!settled && cfg.reuseSpinner && spinner.intervalMs > 0) {
            startSpinnerTimer(panelState, spinner.intervalMs, () => {
              if (
                panelState.settled ||
                now() - (panelState.startedAt ?? 0) > MAX_SPINNER_TIMER_MS
              ) {
                stopSpinnerTimer(panelState);
                return;
              }
              component.invalidate();
              context.invalidate?.();
              requestRender?.();
            });
          } else {
            stopSpinnerTimer(panelState);
          }

          const isError = Boolean(context.isError || panelState.resultIsError);
          const stateToken: PanelStateToken = !settled
            ? "toolPendingBg"
            : isError
              ? "toolErrorBg"
              : "toolSuccessBg";
          const { innerWidth, surfaceActive } = resolvePanelFrameLayout(width, {
            mode: cfg.mode,
            borderStyle: cfg.borderStyle,
            accentStripe: cfg.accentStripe,
            outputPad: context.outputPad === 0 ? 0 : 1,
            colored: ui.colored,
            surface: cfg.surface,
          });

          let callLines: string[] = [];
          if (innerCall) {
            try {
              callLines = normalizeInnerCallLines(
                toolName,
                innerCall.render(innerWidth),
              );
            } catch {
              callLines = [];
            }
          }

          panelState.hasCallLines = callLines.length > 0;

          const verb = resolveToolVerb(toolName, cfg);
          const argumentsOnly = cfg.toolVerbosity === "low";
          const verbLabel = argumentsOnly
            ? toolName
            : settled
              ? verb.settled
              : verb.active;
          const headerParts: string[] = [];

          if (!argumentsOnly && !settled && cfg.reuseSpinner) {
            // Freeze the top-line spinner on tall executing boxes so timer invalidations
            // only touch bottom lines instead of triggering above-viewport full redraws.
            const freezeSpinner =
              Boolean(context.executionStarted) &&
              callLines.length > 8 &&
              panelState.lockedSpinnerFrame !== undefined;
            const spinnerFrame = freezeSpinner
              ? (panelState.lockedSpinnerFrame as string)
              : spinner.frame;
            if (!freezeSpinner) {
              panelState.lockedSpinnerFrame = spinnerFrame;
            }
            if (spinnerFrame !== "") {
              headerParts.push(spinnerFrame);
            }
          }

          headerParts.push(
            bold(theme, fg(theme, "toolTitle", verbLabel, ui.colored)),
          );

          const summary = formatToolCallSummary(toolName, args);
          if (summary !== undefined) {
            headerParts.push(
              fg(theme, surfaceActive ? "text" : "muted", summary, ui.colored),
            );
          }

          if (!argumentsOnly && settled && cfg.outcomeBadges) {
            const badge = isError
              ? fg(theme, "error", "✗", ui.colored)
              : fg(theme, "success", "✓", ui.colored);
            headerParts.push(badge);
            const duration = formatToolDuration(context.durationMs);
            if (duration !== undefined) {
              headerParts.push(
                fg(theme, surfaceActive ? "text" : "dim", duration, ui.colored),
              );
            }
          }

          const headerLine = headerParts.join(" ");

          let hasResultLines = false;
          if (panelState.resultCalled && panelState.renderResultLines) {
            const computed = panelState.renderResultLines(innerWidth);
            panelState.cachedResult = { width, lines: computed };
            hasResultLines = computed.length > 0;
          }

          const framed = framePanelLines(
            [headerLine, ...callLines],
            width,
            theme,
            {
              mode: cfg.mode,
              borderStyle: cfg.borderStyle,
              accentStripe: cfg.accentStripe,
              outputPad: context.outputPad === 0 ? 0 : 1,
              stateToken,
              includeTop: true,
              includeBottom: !hasResultLines,
              colored: ui.colored,
              surface: cfg.surface,
            },
          );
          panelState.cachedCallRender = { key: cacheKey, lines: framed };
          return framed;
        },
        dispose(): void {
          stopSpinnerTimer(panelState);
        },
      };
      return component;
    },

    renderResult(
      result,
      options,
      theme,
      context,
    ): Component & { dispose?: () => void } {
      const config = getConfig();
      const { expanded, hideOutput } = toolOutputDisplay(
        config.toolVerbosity,
        options.expanded,
        toolName,
      );
      const effectiveOptions: ToolRenderResultOptions = {
        ...options,
        expanded,
      };
      const effectiveContext = { ...context, expanded };
      if (!hideOutput && !config.enabled && base?.renderResult) {
        return base.renderResult(
          result,
          effectiveOptions,
          theme,
          effectiveContext,
        );
      }
      const panelState = getPanelState(context);
      panelState.resultCalled = true;
      panelState.resultIsError = isResultError(result);
      panelState.settled = true;
      stopSpinnerTimer(panelState);
      panelState.cachedResult = undefined;
      panelState.cachedResultRender = undefined;
      panelState.cachedCallRender = undefined;

      const innerResultContext: ToolRenderContext = {
        ...effectiveContext,
        outputPad: 0,
        lastComponent: context.lastComponent
          ? panelState.innerResultComponent
          : undefined,
      };
      let innerResult: Component | undefined;
      if (!hideOutput && base?.renderResult) {
        try {
          innerResult = base.renderResult(
            result,
            effectiveOptions,
            theme,
            innerResultContext,
          );
          panelState.innerResultComponent = innerResult;
        } catch {
          panelState.innerResultComponent = undefined;
          innerResult = undefined;
        }
      } else {
        panelState.innerResultComponent = undefined;
      }

      const computeLines = (innerWidth: number): string[] => {
        if (hideOutput) return [];
        const cfg = getConfig();
        if (innerResult) {
          try {
            const rendered = trimEdgeBlankLines(innerResult.render(innerWidth));
            return toolName === "codemode"
              ? applyCodemodeVerbPack(rendered, cfg)
              : rendered;
          } catch {
            // Fall through to safe text extraction inside the frame.
          }
        }
        const ui = getUi();
        return trimEdgeBlankLines(
          renderFallbackResultLines(
            result,
            effectiveOptions,
            theme,
            ui.colored,
            isPanelSurfaceActive(cfg.surface, ui.colored),
          ),
        );
      };

      panelState.renderResultLines = computeLines;
      panelState.resultInvalidate = () => innerResult?.invalidate?.();

      return {
        invalidate(): void {
          panelState.cachedResult = undefined;
          panelState.cachedResultRender = undefined;
          panelState.cachedCallRender = undefined;
          innerResult?.invalidate?.();
        },
        render(width: number): string[] {
          const cfg = getConfig();
          const ui = getUi();
          const cacheKey = `${width}:${getConfigCacheKey(cfg, ui)}`;
          if (panelState.cachedResultRender?.key === cacheKey) {
            return panelState.cachedResultRender.lines;
          }

          const { innerWidth } = resolvePanelFrameLayout(width, {
            mode: cfg.mode,
            borderStyle: cfg.borderStyle,
            accentStripe: cfg.accentStripe,
            outputPad: context.outputPad === 0 ? 0 : 1,
            colored: ui.colored,
            surface: cfg.surface,
          });
          const lines =
            panelState.cachedResult?.width === width
              ? panelState.cachedResult.lines
              : computeLines(innerWidth);

          if (lines.length === 0) {
            panelState.cachedResultRender = { key: cacheKey, lines: [] };
            return [];
          }

          const settled = !options.isPartial && !context.isPartial;
          const stateToken: PanelStateToken = !settled
            ? "toolPendingBg"
            : context.isError || panelState.resultIsError
              ? "toolErrorBg"
              : "toolSuccessBg";

          const displayLines =
            panelState.hasCall && panelState.hasCallLines
              ? ["", ...lines]
              : lines;

          const framed = framePanelLines(displayLines, width, theme, {
            mode: cfg.mode,
            borderStyle: cfg.borderStyle,
            accentStripe: cfg.accentStripe,
            outputPad: context.outputPad === 0 ? 0 : 1,
            stateToken,
            includeTop: !panelState.hasCall,
            includeBottom: true,
            colored: ui.colored,
            surface: cfg.surface,
          });
          panelState.cachedResultRender = { key: cacheKey, lines: framed };
          return framed;
        },
        dispose(): void {
          stopSpinnerTimer(panelState);
        },
      };
    },
  };
}
