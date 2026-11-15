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
  type Component,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { type BorderStyle, getBorderChars } from "@hollowheap/core/border";
import type {
  CustomToolVerb,
  ToolBoxConfig,
  ToolVerbPack,
} from "@hollowheap/core/tui-config";
import {
  type WorkingTheme,
  crushWorkingIndicator,
} from "@hollowheap/tui/spinner";

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

/** Resolve active/settled verb labels for a tool using custom overrides, packs, or fallback. */
export function resolveToolVerb(
  toolName: string,
  config: Pick<ToolBoxConfig, "verbPack" | "customVerbs">,
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
  const pattern = pick("pattern");
  const path = pick("path");
  if (pattern && path) return `${pattern} in ${path}`;
  return path ?? pattern ?? pick("command") ?? pick("query") ?? pick("url");
}

function isWorkingTheme(theme: unknown): theme is WorkingTheme {
  if (typeof theme !== "object" || theme === null) return false;
  const candidate = theme as Partial<WorkingTheme>;
  return (
    typeof candidate.getColorMode === "function" &&
    typeof candidate.colors === "object" &&
    candidate.colors !== null &&
    "accent" in candidate.colors &&
    "borderAccent" in candidate.colors &&
    "success" in candidate.colors &&
    "warning" in candidate.colors &&
    "error" in candidate.colors &&
    "thinkingText" in candidate.colors &&
    "text" in candidate.colors &&
    "muted" in candidate.colors
  );
}

interface ToolBoxState {
  hasCall?: boolean;
  resultCalled?: boolean;
  resultIsError?: boolean;
  startedAt?: number;
  spinnerTheme?: unknown;
  spinner?: { frames: string[]; intervalMs: number };
  renderResultLines?: (innerWidth: number) => string[];
  resultInvalidate?: () => void;
  cachedResult?: { width: number; lines: string[] };
}

function getBoxState(context: ToolRenderContext | undefined): ToolBoxState {
  if (context && typeof context.state === "object" && context.state !== null) {
    return context.state as ToolBoxState;
  }
  return {};
}

function fg(theme: Theme | undefined, token: string, value: string): string {
  return typeof theme?.fg === "function"
    ? theme.fg(token as never, value)
    : value;
}

function bold(theme: Theme | undefined, value: string): string {
  return typeof theme?.bold === "function" ? theme.bold(value) : value;
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

function frameBoxLines(
  lines: readonly string[],
  width: number,
  theme: Theme | undefined,
  options: {
    borderStyle: BorderStyle;
    accentStripe: boolean;
    stripeToken: "accent" | "success" | "error";
    includeTop: boolean;
    includeBottom: boolean;
  },
): string[] {
  const safeWidth = Math.max(4, width);
  const bordered = options.borderStyle !== "none" && safeWidth >= 6;
  const stripe = options.accentStripe
    ? fg(theme, options.stripeToken, "▎")
    : "";
  const innerWidth = getInnerWidth(
    safeWidth,
    options.borderStyle,
    options.accentStripe,
  );

  if (!bordered) {
    return lines.map((line) => {
      const fitted =
        visibleWidth(line) > innerWidth
          ? truncateToWidth(line, innerWidth, "")
          : line;
      return options.accentStripe ? `${stripe} ${fitted}` : fitted;
    });
  }

  const chars = getBorderChars(options.borderStyle);
  const borderPaint = (value: string) => fg(theme, "border", value);
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

  for (const line of lines) {
    const fitted =
      visibleWidth(line) > innerWidth
        ? truncateToWidth(line, innerWidth, "")
        : line;
    const pad = Math.max(0, innerWidth - visibleWidth(fitted));
    out.push(`${leftEdge}${fitted}${" ".repeat(pad)}${rightEdge}`);
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
): string[] {
  const output = extractResultText(result);
  if (!output) return [];
  const rawLines = output.split("\n");
  const visible = options.expanded
    ? rawLines
    : rawLines.slice(0, FALLBACK_RESULT_PREVIEW_LINES);
  const lines = visible.map((line) => fg(theme, "toolOutput", line));
  const remaining = rawLines.length - visible.length;
  if (remaining > 0) {
    lines.push(fg(theme, "muted", `... (${remaining} more lines)`));
  }
  return lines;
}

function getSpinnerFrame(
  boxState: ToolBoxState,
  theme: Theme | undefined,
  nowMs: number,
): string {
  if (boxState.startedAt === undefined) {
    boxState.startedAt = nowMs;
  }
  const startedAt = boxState.startedAt;
  const elapsed = Math.max(0, nowMs - startedAt);
  if (isWorkingTheme(theme)) {
    if (boxState.spinnerTheme !== theme || !boxState.spinner) {
      boxState.spinnerTheme = theme;
      boxState.spinner = crushWorkingIndicator(theme);
    }
    const { frames, intervalMs } = boxState.spinner;
    const idx = Math.floor(elapsed / intervalMs) % frames.length;
    return frames[idx] ?? frames[0] ?? "";
  }
  const idx =
    Math.floor(elapsed / FALLBACK_SPINNER_INTERVAL_MS) %
    FALLBACK_SPINNER_FRAMES.length;
  return fg(theme, "accent", FALLBACK_SPINNER_FRAMES[idx] ?? "⠋");
}

export interface WrapToolRendererOptions {
  now?: () => number;
}

/** Wrap a tool's renderers with configurable tool-box framing, verbs, spinner, and badges. */
export function wrapToolRenderer(
  toolName: string,
  base: ToolRenderers | undefined,
  getConfig: () => ToolBoxConfig,
  wrapOptions?: WrapToolRendererOptions,
): ToolRenderers {
  const now = wrapOptions?.now ?? Date.now;

  return {
    renderShell: "self",
    renderCall(args, theme, context): Component {
      const effectiveContext =
        toolName === "codemode" ? { ...context, expanded: true } : context;
      const boxState = getBoxState(context);
      boxState.hasCall = true;
      boxState.resultCalled = false;
      boxState.renderResultLines = undefined;
      boxState.resultInvalidate = undefined;
      boxState.cachedResult = undefined;
      boxState.startedAt ??= now();

      const innerCall = base?.renderCall?.(args, theme, effectiveContext);

      return {
        invalidate(): void {
          boxState.cachedResult = undefined;
          innerCall?.invalidate?.();
        },
        render(width: number): string[] {
          const cfg = getConfig();
          const settled = !context.isPartial;
          const isError = Boolean(context.isError || boxState.resultIsError);
          const stripeToken = !settled
            ? "accent"
            : isError
              ? "error"
              : "success";
          const innerWidth = getInnerWidth(
            width,
            cfg.borderStyle,
            cfg.accentStripe,
          );

          const verb = resolveToolVerb(toolName, cfg);
          const verbLabel = settled ? verb.settled : verb.active;
          const headerParts: string[] = [];

          if (!settled && cfg.reuseSpinner) {
            headerParts.push(getSpinnerFrame(boxState, theme, now()));
          }

          headerParts.push(bold(theme, fg(theme, "toolTitle", verbLabel)));

          const summary = formatToolCallSummary(toolName, args);
          if (summary !== undefined) {
            headerParts.push(fg(theme, "muted", summary));
          }

          if (settled && cfg.outcomeBadges) {
            const badge = isError
              ? fg(theme, "error", "✗")
              : fg(theme, "success", "✓");
            headerParts.push(badge);
            const duration = formatToolDuration(context.durationMs);
            if (duration !== undefined) {
              headerParts.push(fg(theme, "dim", duration));
            }
          }

          const headerLine = headerParts.join(" ");
          const callLines = innerCall ? innerCall.render(innerWidth) : [];

          let hasResultLines = false;
          if (boxState.resultCalled && boxState.renderResultLines) {
            const computed = boxState.renderResultLines(innerWidth);
            boxState.cachedResult = { width, lines: computed };
            hasResultLines = computed.length > 0;
          }

          return frameBoxLines([headerLine, ...callLines], width, theme, {
            borderStyle: cfg.borderStyle,
            accentStripe: cfg.accentStripe,
            stripeToken,
            includeTop: true,
            includeBottom: !hasResultLines,
          });
        },
      };
    },

    renderResult(result, options, theme, context): Component {
      const effectiveContext =
        toolName === "codemode" ? { ...context, expanded: true } : context;
      const boxState = getBoxState(context);
      boxState.resultCalled = true;
      boxState.resultIsError = Boolean(result.isError);
      boxState.cachedResult = undefined;

      const innerResult = base?.renderResult?.(
        result,
        options,
        theme,
        effectiveContext,
      );

      const computeLines = (innerWidth: number): string[] => {
        if (innerResult) {
          return innerResult.render(innerWidth);
        }
        return renderFallbackResultLines(result, options, theme);
      };

      boxState.renderResultLines = computeLines;
      boxState.resultInvalidate = () => innerResult?.invalidate?.();

      return {
        invalidate(): void {
          boxState.cachedResult = undefined;
          innerResult?.invalidate?.();
        },
        render(width: number): string[] {
          const cfg = getConfig();
          const innerWidth = getInnerWidth(
            width,
            cfg.borderStyle,
            cfg.accentStripe,
          );
          const lines =
            boxState.cachedResult?.width === width
              ? boxState.cachedResult.lines
              : computeLines(innerWidth);

          if (lines.length === 0) {
            return [];
          }

          const settled = !options.isPartial && !context.isPartial;
          const stripeToken = !settled
            ? "accent"
            : context.isError || result.isError
              ? "error"
              : "success";

          return frameBoxLines(lines, width, theme, {
            borderStyle: cfg.borderStyle,
            accentStripe: cfg.accentStripe,
            stripeToken,
            includeTop: !boxState.hasCall,
            includeBottom: true,
          });
        },
      };
    },
  };
}
