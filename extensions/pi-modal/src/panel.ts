import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";

type ToolRenderContext = Parameters<
  NonNullable<ToolRenderers["renderCall"]>
>[2];
import {
  type Color,
  type Component,
  type TerminalColorMode,
  foregroundAnsi,
  indexedColor,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { type BorderStyle, getBorderChars } from "@hollowheap/core/border";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import type { OverlaySurfaceMode } from "@hollowheap/core/tui-config";
import type {
  CustomToolVerb,
  LoadingIndicatorStyle,
  PanelConfig,
  PanelRenderMode,
  ToolVerbPack,
} from "@hollowheap/core/tui-config";
import { createWorkingIndicator } from "@hollowheap/tui/spinner";
import { getActiveTuiConfig } from "@hollowheap/tui/state";
import { paintSurfaceLine } from "@hollowheap/tui/surface";

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
  },
};

function formatUnknownToolName(toolName: string): string {
  const cleaned = toolName.replace(/[_-]+/g, " ").trim() || toolName;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export type PanelRenderConfig = PanelConfig & {
  verbPack: ToolVerbPack;
  surface?: OverlaySurfaceMode;
};

/** Resolve active/settled verb labels for a tool using custom overrides, packs, or fallback. */
export function resolveToolVerb(
  toolName: string,
  config: Pick<PanelRenderConfig, "verbPack" | "customVerbs">,
): CustomToolVerb {
  const custom = config.customVerbs?.[toolName];
  if (custom) return custom;
  const pack = VERB_PACKS[config.verbPack] ?? VERB_PACKS.standard;
  const known = pack[toolName];
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

type PanelStateToken = "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

const STATE_FALLBACK_TOKEN: Readonly<
  Record<PanelStateToken, "accent" | "success" | "error">
> = {
  toolPendingBg: "accent",
  toolSuccessBg: "success",
  toolErrorBg: "error",
};

interface ColorTheme {
  colors?: Readonly<Record<string, Color | undefined>>;
  getColorMode?: () => TerminalColorMode;
}

/** ANSI 8 base colors become their brighter ANSI 16 variants for foreground use. */
function brightenBaseAnsi(color: Color): Color {
  return color.kind === "indexed" && color.index < 8
    ? indexedColor(color.index + 8)
    : color;
}

function stateAnsi(
  theme: Theme | undefined,
  token: PanelStateToken,
  colored: boolean,
): string | undefined {
  if (!colored || theme === undefined) return undefined;
  const candidate = theme as unknown as ColorTheme;
  const color = candidate.colors?.[token];
  if (color === undefined || typeof candidate.getColorMode !== "function") {
    return undefined;
  }
  return foregroundAnsi(brightenBaseAnsi(color), candidate.getColorMode());
}

function paintState(
  theme: Theme | undefined,
  token: PanelStateToken,
  colored: boolean,
  value: string,
): string {
  const ansi = stateAnsi(theme, token, colored);
  if (ansi !== undefined) return `${ansi}${value}\x1b[39m`;
  return fg(theme, STATE_FALLBACK_TOKEN[token], value, colored);
}

const ESC = String.fromCharCode(27);
const SGR_PATTERN = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

/** Drop inherited background colors so only the panel state color remains. */
export function stripBackgroundSgr(text: string): string {
  return text.replace(SGR_PATTERN, (match, params: string) => {
    if (params === "") return match;
    const parts = params.split(";");
    const kept: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      const code = Number.parseInt(part === "" ? "0" : part, 10);
      if (code === 48) {
        const mode = parts[index + 1];
        if (mode === "5") {
          index += 2;
        } else if (mode === "2") {
          index += 4;
        }
        continue;
      }
      if (code === 49) continue;
      if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) continue;
      kept.push(part);
    }
    return kept.length === 0 ? "" : `\x1b[${kept.join(";")}m`;
  });
}

function getInnerWidth(
  width: number,
  borderStyle: BorderStyle,
  accentStripe: boolean,
): number {
  const safeWidth = Math.max(4, width);
  const bordered = borderStyle !== "none" && safeWidth >= 6;
  if (bordered) {
    return Math.max(1, safeWidth - (accentStripe ? 5 : 4));
  }
  return Math.max(1, safeWidth - (accentStripe ? 2 : 0));
}

function framePanelLines(
  lines: readonly string[],
  width: number,
  theme: Theme | undefined,
  options: {
    mode?: PanelRenderMode;
    borderStyle: BorderStyle;
    accentStripe: boolean;
    stateToken: PanelStateToken;
    includeTop: boolean;
    includeBottom: boolean;
    colored?: boolean;
    surface?: OverlaySurfaceMode;
  },
): string[] {
  const safeWidth = Math.max(4, width);
  const colored = options.colored ?? true;
  const bordered =
    options.mode !== "background" &&
    options.borderStyle !== "none" &&
    safeWidth >= 6;
  const paint = (value: string) =>
    paintState(theme, options.stateToken, colored, value);
  const stripe = options.accentStripe ? paint("▎") : "";
  const content = lines.map(stripBackgroundSgr);
  const innerWidth = getInnerWidth(
    safeWidth,
    options.mode === "background" ? "none" : options.borderStyle,
    options.accentStripe,
  );

  if (!bordered) {
    const surface =
      options.mode === "background"
        ? options.surface && options.surface !== "transparent"
          ? options.surface
          : "surface"
        : options.surface;
    return content.map((line) => {
      const fitted =
        visibleWidth(line) > innerWidth
          ? truncateToWidth(line, innerWidth, "")
          : line;
      const resetTail =
        fitted.includes("\x1b[") && !fitted.endsWith("\x1b[0m")
          ? "\x1b[0m"
          : "";
      const body =
        surface !== undefined && surface !== "transparent"
          ? paintSurfaceLine(fitted, innerWidth, theme, surface, colored)
          : fitted;
      return `${stripe}${stripe.length > 0 ? " " : ""}${body}${resetTail}`;
    });
  }

  const chars = getBorderChars(options.borderStyle);
  const borderPaint = paint;
  const out: string[] = [];

  if (options.includeTop) {
    out.push(
      borderPaint(
        `${chars.topLeft}${chars.horizontal.repeat(safeWidth - 2)}${chars.topRight}`,
      ),
    );
  }

  const leftEdge =
    borderPaint(chars.vertical) + (options.accentStripe ? `${stripe} ` : " ");
  const rightEdge = ` ${borderPaint(chars.vertical)}`;

  const surface = options.surface ?? "transparent";
  for (const line of content) {
    const fitted =
      visibleWidth(line) > innerWidth
        ? truncateToWidth(line, innerWidth, "")
        : line;
    const pad = Math.max(0, innerWidth - visibleWidth(fitted));
    const resetTail =
      fitted.includes("\x1b[") && !fitted.endsWith("\x1b[0m") ? "\x1b[0m" : "";
    if (surface !== "transparent") {
      const inner = paintSurfaceLine(
        fitted,
        innerWidth,
        theme,
        surface,
        colored,
      );
      out.push(`${leftEdge}${inner}${resetTail}${rightEdge}`);
    } else {
      out.push(
        `${leftEdge}${fitted}${resetTail}${" ".repeat(pad)}${rightEdge}`,
      );
    }
  }

  if (options.includeBottom) {
    out.push(
      borderPaint(
        `${chars.bottomLeft}${chars.horizontal.repeat(safeWidth - 2)}${chars.bottomRight}`,
      ),
    );
  }

  return out;
}

function extractResultText(result: AgentToolResult<unknown>): string {
  if (!Array.isArray(result.content)) return "";
  const parts: string[] = [];
  for (const block of result.content) {
    if (
      typeof block === "object" &&
      block !== null &&
      block.type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

function renderFallbackResultLines(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme | undefined,
  colored = true,
): string[] {
  const output = extractResultText(result);
  if (!output) return [];
  const rawLines = output.split("\n");
  const visible = options.expanded
    ? rawLines
    : rawLines.slice(0, FALLBACK_RESULT_PREVIEW_LINES);
  const lines = visible.map((line) => fg(theme, "toolOutput", line, colored));
  const remaining = rawLines.length - visible.length;
  if (remaining > 0) {
    lines.push(fg(theme, "muted", `... (${remaining} more lines)`, colored));
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
    renderCall(args, theme, context): Component {
      const effectiveContext =
        toolName === "codemode" ? { ...context, expanded: true } : context;
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

      const component: Component = {
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
              if (panelState.settled) {
                stopSpinnerTimer(panelState);
                return;
              }
              component.invalidate();
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
          const innerWidth = getInnerWidth(
            width,
            cfg.borderStyle,
            cfg.accentStripe,
          );

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
          const verbLabel = settled ? verb.settled : verb.active;
          const headerParts: string[] = [];

          if (!settled && cfg.reuseSpinner) {
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
            headerParts.push(fg(theme, "muted", summary, ui.colored));
          }

          if (settled && cfg.outcomeBadges) {
            const badge = isError
              ? fg(theme, "error", "✗", ui.colored)
              : fg(theme, "success", "✓", ui.colored);
            headerParts.push(badge);
            const duration = formatToolDuration(context.durationMs);
            if (duration !== undefined) {
              headerParts.push(fg(theme, "dim", duration, ui.colored));
            }
          }

          const headerLine = `${headerParts.join(" ")} ${fg(theme, "muted", "(ctrl+o to expand/collapse)")}`;

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
      };
      return component;
    },

    renderResult(result, options, theme, context): Component {
      const effectiveContext =
        toolName === "codemode" ? { ...context, expanded: true } : context;
      const panelState = getPanelState(context);
      panelState.resultCalled = true;
      panelState.resultIsError = Boolean(result.isError);
      panelState.settled = true;
      stopSpinnerTimer(panelState);
      panelState.cachedResult = undefined;
      panelState.cachedResultRender = undefined;
      panelState.cachedCallRender = undefined;

      const innerResultContext: ToolRenderContext = {
        ...effectiveContext,
        lastComponent: context.lastComponent
          ? panelState.innerResultComponent
          : undefined,
      };
      let innerResult: Component | undefined;
      if (base?.renderResult) {
        try {
          innerResult = base.renderResult(
            result,
            options,
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
        if (innerResult) {
          try {
            return trimEdgeBlankLines(innerResult.render(innerWidth));
          } catch {
            // Fall through to safe text extraction inside the frame.
          }
        }
        return trimEdgeBlankLines(
          renderFallbackResultLines(result, options, theme, getUi().colored),
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

          const innerWidth = getInnerWidth(
            width,
            cfg.borderStyle,
            cfg.accentStripe,
          );
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
            : context.isError || result.isError
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
            stateToken,
            includeTop: !panelState.hasCall,
            includeBottom: true,
            colored: ui.colored,
            surface: cfg.surface,
          });
          panelState.cachedResultRender = { key: cacheKey, lines: framed };
          return framed;
        },
      };
    },
  };
}
