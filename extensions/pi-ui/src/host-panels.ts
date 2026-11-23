import {
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  type MarkdownTransformer,
  type ParsedSkillBlock,
  SkillInvocationMessageComponent,
  type Theme,
  UserMessageComponent,
  keyText,
  parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Container,
  Markdown,
  type MarkdownTheme,
  MouseRegion,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";
import {
  type PanelStateToken,
  framePanelLines,
  isPanelSurfaceActive,
  resolvePanelFrameLayout,
} from "@hollowheap/ui/frame";
import { panelRenderConfig, resolveToolVerb } from "@hollowheap/ui/panel";
import { getActiveTuiConfig } from "@hollowheap/ui/state";
import { safeFg } from "@hollowheap/ui/theme";
import { getPromptChar as sharedGetPromptChar } from "./prompt-char.js";

const SKILL_PANEL = Symbol.for("@hollowheap/pi-ui/skill-panel");
const BASH_PANEL = Symbol.for("@hollowheap/pi-ui/bash-panel");
const BRANCH_SUMMARY_PANEL = Symbol.for(
  "@hollowheap/pi-ui/branch-summary-panel",
);
const COMPACTION_SUMMARY_PANEL = Symbol.for(
  "@hollowheap/pi-ui/compaction-summary-panel",
);
const CUSTOM_MESSAGE_PANEL = Symbol.for(
  "@hollowheap/pi-ui/custom-message-panel",
);
const USER_MESSAGE_PANEL = Symbol.for("@hollowheap/pi-ui/user-message-panel");

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const steeredMessageCounts = new Map<string, number>();

export function markSteeredUserMessage(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  steeredMessageCounts.set(
    trimmed,
    (steeredMessageCounts.get(trimmed) ?? 0) + 1,
  );
  if (text !== trimmed) {
    steeredMessageCounts.set(text, (steeredMessageCounts.get(text) ?? 0) + 1);
  }
}

function consumeSteeredUserMessage(text: string): boolean {
  const exact = steeredMessageCounts.get(text) ?? 0;
  if (exact > 0) {
    if (exact === 1) steeredMessageCounts.delete(text);
    else steeredMessageCounts.set(text, exact - 1);
    const trimmed = text.trim();
    if (trimmed !== text) {
      const trimCount = steeredMessageCounts.get(trimmed) ?? 0;
      if (trimCount <= 1) steeredMessageCounts.delete(trimmed);
      else steeredMessageCounts.set(trimmed, trimCount - 1);
    }
    return true;
  }
  const trimmed = text.trim();
  const trimCount = steeredMessageCounts.get(trimmed) ?? 0;
  if (trimCount > 0) {
    if (trimCount === 1) steeredMessageCounts.delete(trimmed);
    else steeredMessageCounts.set(trimmed, trimCount - 1);
    return true;
  }
  return false;
}

function syncPanelEnabledOnRender<
  T extends { render(width: number): string[]; invalidate(): void },
>(
  prototype: T,
  syncMethod: (instance: T) => void,
  postProcess?: (lines: string[]) => string[],
): void {
  const renderedPanelState = new WeakMap<T, boolean>();
  const originalRender = Reflect.get(prototype, "render") as
    | ((this: T, width: number) => string[])
    | undefined;
  if (typeof originalRender !== "function") return;
  Reflect.set(prototype, "render", function (this: T, width: number): string[] {
    const enabled = panelRenderConfig(getActiveTuiConfig()).enabled;
    const prev = renderedPanelState.get(this);
    if (prev !== undefined && prev !== enabled) {
      renderedPanelState.set(this, enabled);
      syncMethod(this);
      this.invalidate();
    } else if (prev === undefined) {
      renderedPanelState.set(this, enabled);
    }
    const lines = originalRender.call(this, width);
    return postProcess ? postProcess(lines) : lines;
  });
}

interface HostPanelStyleTarget {
  setPaddingX(paddingX: number): void;
  setBgFn(bgFn: never): void;
}

export function createHostPanelStyleState<T extends HostPanelStyleTarget>() {
  const outputPadMap = new WeakMap<T, number>();
  const hostPaddingYMap = new WeakMap<T, number>();
  const hostBgFnMap = new WeakMap<T, unknown>();
  return {
    setOutputPad(instance: T, outputPad: number): void {
      outputPadMap.set(instance, outputPad);
    },
    capture(instance: T): void {
      if (!outputPadMap.has(instance)) {
        const boxPad = Reflect.get(instance, "paddingX");
        outputPadMap.set(instance, typeof boxPad === "number" ? boxPad : 1);
      }
      if (!hostPaddingYMap.has(instance)) {
        const boxPadY = Reflect.get(instance, "paddingY");
        hostPaddingYMap.set(
          instance,
          typeof boxPadY === "number" ? boxPadY : 1,
        );
      }
      if (!hostBgFnMap.has(instance)) {
        hostBgFnMap.set(instance, Reflect.get(instance, "bgFn"));
      }
    },
    getOutputPad(instance: T): number {
      return outputPadMap.get(instance) ?? 1;
    },
    restore(instance: T): void {
      instance.setPaddingX(outputPadMap.get(instance) ?? 1);
      Reflect.set(instance, "paddingY", hostPaddingYMap.get(instance) ?? 1);
      instance.setBgFn(hostBgFnMap.get(instance) as never);
    },
  };
}

export function formatBoldCustomMessageLabel(
  theme: Theme | undefined,
  label: string,
  colored: boolean,
): string {
  return safeFg(
    theme,
    "customMessageLabel",
    `\x1b[1m${label}\x1b[22m`,
    colored,
  );
}

export function renderPanelOrFallback(
  lines: readonly string[],
  width: number,
  pad: number,
  theme: Theme | undefined,
  stateToken: PanelStateToken = "toolSuccessBg",
  extraOptions?: {
    firstLinePrefix?: string;
    topLeftLabel?: string;
    bottomRightLabel?: string;
  },
): string[] {
  const config = getActiveTuiConfig();
  const panel = panelRenderConfig(config);
  if (!panel.enabled) {
    const inset = " ".repeat(pad);
    return lines.map((line) => `${inset}${line}`);
  }
  return framePanelLines(lines, width, theme, {
    mode: panel.mode,
    borderStyle: panel.borderStyle,
    accentStripe: panel.accentStripe,
    outputPad: pad,
    stateToken,
    includeTop: true,
    includeBottom: true,
    colored: config.colored,
    surface: panel.surface,
    ...extraOptions,
  });
}

export function getPanelOrFallbackInnerWidth(
  width: number,
  pad: number,
): number {
  const config = getActiveTuiConfig();
  const panel = panelRenderConfig(config);
  if (!panel.enabled) {
    return Math.max(1, width - 2 * pad);
  }
  return resolvePanelFrameLayout(width, {
    mode: panel.mode,
    borderStyle: panel.borderStyle,
    accentStripe: panel.accentStripe,
    outputPad: pad,
    colored: config.colored,
    surface: panel.surface,
  }).innerWidth;
}

function collectSkillBlocks(first: ParsedSkillBlock): ParsedSkillBlock[] {
  const blocks = [first];
  let remaining = first.userMessage;
  while (remaining) {
    const block = parseSkillBlock(remaining);
    if (!block) break;
    blocks.push(block);
    remaining = block.userMessage;
  }
  // The host uses this render-time object to display the remaining user prompt.
  first.userMessage = remaining;
  return blocks;
}

/** Reuse the host's skill lifecycle, keybinding, and transcript placement. */
export function installSkillPanel(getTheme: () => Theme | undefined): void {
  const prototype = SkillInvocationMessageComponent.prototype;
  const installed = Reflect.get(prototype, SKILL_PANEL) as
    | { getTheme: typeof getTheme }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    return;
  }
  // Pi renders skill invocations through a native component with no renderer hook.
  const original = Reflect.get(prototype, "updateDisplay");
  if (typeof original !== "function") return;
  const patch = { getTheme };
  const groups = new WeakMap<ParsedSkillBlock, ParsedSkillBlock[]>();
  const hostStyle =
    createHostPanelStyleState<SkillInvocationMessageComponent>();
  Reflect.set(prototype, SKILL_PANEL, patch);
  Reflect.set(
    prototype,
    "setOutputPad",
    function (this: SkillInvocationMessageComponent, outputPad: number) {
      hostStyle.setOutputPad(this, outputPad);
      if (panelRenderConfig(getActiveTuiConfig()).enabled) {
        this.setPaddingX(0);
        Reflect.set(this, "paddingY", 0);
      } else {
        this.setPaddingX(outputPad);
      }
    },
  );
  Reflect.set(
    prototype,
    "updateDisplay",
    function (this: SkillInvocationMessageComponent) {
      const first = Reflect.get(this, "skillBlock") as
        | ParsedSkillBlock
        | undefined;
      const expanded = Reflect.get(this, "expanded");
      const markdownTheme = Reflect.get(this, "markdownTheme") as
        | MarkdownTheme
        | undefined;
      if (!first || typeof expanded !== "boolean" || !markdownTheme) {
        original.call(this);
        return;
      }

      hostStyle.capture(this);

      if (!panelRenderConfig(getActiveTuiConfig()).enabled) {
        hostStyle.restore(this);
        original.call(this);
        return;
      }

      let blocks = groups.get(first);
      if (!blocks) {
        blocks = collectSkillBlocks(first);
        groups.set(first, blocks);
      }
      const names = blocks.map(({ name }) => `$${name}`).join(" ");
      const shortcut = keyText("app.tools.expand");
      const action = expanded ? "collapse" : "expand";
      const hint = shortcut ? `${shortcut} to ${action}` : `click to ${action}`;
      const body = expanded
        ? new Markdown(
            blocks
              .map(({ name, content }) => `**$${name}**\n\n${content}`)
              .join("\n\n"),
            0,
            0,
            markdownTheme,
          )
        : undefined;
      const header = new Text("", 0, 0);

      this.clear();
      this.setPaddingX(0);
      Reflect.set(this, "paddingY", 0);
      this.setBgFn(undefined);
      this.addChild(
        new MouseRegion(
          {
            invalidate: () => body?.invalidate(),
            render: (width) => {
              const config = getActiveTuiConfig();
              const theme = patch.getTheme();
              const pad = hostStyle.getOutputPad(this);
              const innerWidth = getPanelOrFallbackInnerWidth(width, pad);
              const hintText = safeFg(theme, "dim", hint, config.colored);
              header.setText(`${names} (${hintText})`);
              const lines = [
                ...header.render(innerWidth),
                ...(body?.render(innerWidth) ?? []),
              ];
              return renderPanelOrFallback(lines, width, pad, theme);
            },
          },
          (event) => {
            if (event.type !== "click" || event.button !== "left")
              return undefined;
            this.setExpanded(!expanded);
            return { handled: true };
          },
        ),
      );
    },
  );
  syncPanelEnabledOnRender(prototype, (instance) => {
    const updateDisplay = Reflect.get(instance, "updateDisplay");
    if (typeof updateDisplay === "function") updateDisplay.call(instance);
  });
}

interface SummaryPanelTarget {
  render(width: number): string[];
  invalidate(): void;
  clear(): void;
  addChild(child: Component): void;
  setPaddingX(paddingX: number): void;
  setBgFn(bgFn: never): void;
  setExpanded(expanded: boolean): void;
}

interface SummaryPanelSpec<M extends { summary?: string }> {
  symbol: symbol;
  badge: string;
  formatHeading: (message: M) => string;
  formatCollapsed: (message: M) => string;
}

function installSummaryPanel<
  T extends SummaryPanelTarget,
  M extends { summary?: string },
>(
  prototype: T,
  getTheme: () => Theme | undefined,
  spec: SummaryPanelSpec<M>,
): void {
  const installed = Reflect.get(prototype, spec.symbol) as
    | { getTheme: typeof getTheme }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    return;
  }
  const original = Reflect.get(prototype, "updateDisplay");
  if (typeof original !== "function") return;
  const patch = { getTheme };
  const hostStyle = createHostPanelStyleState<T>();
  Reflect.set(prototype, spec.symbol, patch);
  Reflect.set(prototype, "setOutputPad", function (this: T, outputPad: number) {
    hostStyle.setOutputPad(this, outputPad);
    if (panelRenderConfig(getActiveTuiConfig()).enabled) {
      this.setPaddingX(0);
      Reflect.set(this, "paddingY", 0);
    } else {
      this.setPaddingX(outputPad);
    }
  });
  Reflect.set(prototype, "updateDisplay", function (this: T) {
    const message = Reflect.get(this, "message") as M | undefined;
    const expanded = Reflect.get(this, "expanded");
    const markdownTheme = Reflect.get(this, "markdownTheme") as
      | MarkdownTheme
      | undefined;
    if (
      !message ||
      typeof message.summary !== "string" ||
      typeof expanded !== "boolean" ||
      !markdownTheme
    ) {
      original.call(this);
      return;
    }
    hostStyle.capture(this);
    if (!panelRenderConfig(getActiveTuiConfig()).enabled) {
      hostStyle.restore(this);
      original.call(this);
      return;
    }
    const summary = message.summary;
    const shortcut = keyText("app.tools.expand") || "click";
    const heading = spec.formatHeading(message);
    const collapsedPrefix = spec.formatCollapsed(message);
    const body = expanded
      ? new Markdown(`**${heading}**\n\n${summary}`, 0, 0, markdownTheme, {
          color: (text) =>
            safeFg(
              patch.getTheme(),
              "customMessageText",
              text,
              getActiveTuiConfig().colored,
            ),
        })
      : undefined;
    const collapsedLine = new Text("", 0, 0);

    this.clear();
    this.setPaddingX(0);
    Reflect.set(this, "paddingY", 0);
    this.setBgFn(undefined as never);
    this.addChild(
      new MouseRegion(
        {
          invalidate: () => body?.invalidate(),
          render: (width) => {
            const config = getActiveTuiConfig();
            const theme = patch.getTheme();
            const pad = hostStyle.getOutputPad(this);
            const innerWidth = getPanelOrFallbackInnerWidth(width, pad);
            const lines: string[] = [];
            if (body) {
              lines.push(...body.render(innerWidth));
            } else {
              collapsedLine.setText(
                `${safeFg(theme, "customMessageText", `${collapsedPrefix} (`, config.colored)}${safeFg(theme, "dim", shortcut, config.colored)}${safeFg(theme, "customMessageText", " to expand)", config.colored)}`,
              );
              lines.push(...collapsedLine.render(innerWidth));
            }
            return renderPanelOrFallback(lines, width, pad, theme, undefined, {
              topLeftLabel: spec.badge,
            });
          },
        },
        (event) => {
          if (event.type !== "click" || event.button !== "left")
            return undefined;
          this.setExpanded(!expanded);
          return { handled: true };
        },
      ),
    );
  });
  syncPanelEnabledOnRender(prototype, (instance) => {
    const updateDisplay = Reflect.get(instance, "updateDisplay");
    if (typeof updateDisplay === "function") updateDisplay.call(instance);
  });
}

/** Frame BranchSummaryMessageComponent inside our shared panel with outputPad inside the border. */
export function installBranchSummaryPanel(
  getTheme: () => Theme | undefined,
): void {
  installSummaryPanel<BranchSummaryMessageComponent, { summary?: string }>(
    BranchSummaryMessageComponent.prototype,
    getTheme,
    {
      symbol: BRANCH_SUMMARY_PANEL,
      badge: "[branch]",
      formatHeading: () => "Branch Summary",
      formatCollapsed: () => "Branch summary",
    },
  );
}

/** Frame CompactionSummaryMessageComponent inside our shared panel with outputPad inside the border. */
export function installCompactionSummaryPanel(
  getTheme: () => Theme | undefined,
): void {
  installSummaryPanel<
    CompactionSummaryMessageComponent,
    { summary?: string; tokensBefore?: number }
  >(CompactionSummaryMessageComponent.prototype, getTheme, {
    symbol: COMPACTION_SUMMARY_PANEL,
    badge: "[compaction]",
    formatHeading: (message) => {
      const tokenStr =
        typeof message.tokensBefore === "number"
          ? message.tokensBefore.toLocaleString()
          : "0";
      return `Compacted from ${tokenStr} tokens`;
    },
    formatCollapsed: (message) => {
      const tokenStr =
        typeof message.tokensBefore === "number"
          ? message.tokensBefore.toLocaleString()
          : "0";
      return `Compacted from ${tokenStr} tokens`;
    },
  });
}

/** Frame default CustomMessageComponent fallback inside our shared panel with outputPad inside the border. */
export function installCustomMessagePanel(
  getTheme: () => Theme | undefined,
): void {
  const prototype = CustomMessageComponent.prototype;
  const installed = Reflect.get(prototype, CUSTOM_MESSAGE_PANEL) as
    | { getTheme: typeof getTheme }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    return;
  }
  const original = Reflect.get(prototype, "rebuild");
  if (typeof original !== "function") return;
  const patch = { getTheme };
  const panelChildMap = new WeakMap<CustomMessageComponent, Component>();
  Reflect.set(prototype, CUSTOM_MESSAGE_PANEL, patch);
  Reflect.set(prototype, "rebuild", function (this: CustomMessageComponent) {
    const prevPanelChild = panelChildMap.get(this);
    if (prevPanelChild) {
      this.removeChild(prevPanelChild);
      panelChildMap.delete(this);
    }

    const config = getActiveTuiConfig();
    const panel = panelRenderConfig(config);
    if (!panel.enabled) {
      original.call(this);
      return;
    }

    original.call(this);
    const customComponent = Reflect.get(this, "customComponent") as
      | Component
      | undefined;
    if (customComponent) {
      return;
    }

    const box = Reflect.get(this, "box") as Component | undefined;
    if (box) {
      this.removeChild(box);
    }

    const message = Reflect.get(this, "message") as
      | {
          customType?: string;
          content?: string | Array<{ type?: string; text?: string }>;
        }
      | undefined;
    const markdownTheme = Reflect.get(this, "markdownTheme") as
      | MarkdownTheme
      | undefined;
    if (!message || !markdownTheme) {
      if (box) this.addChild(box);
      return;
    }

    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((c) => c.type === "text" && typeof c.text === "string")
              .map((c) => c.text)
              .join("\n")
          : "";

    const body = new Markdown(text, 0, 0, markdownTheme, {
      color: (val) =>
        safeFg(
          patch.getTheme(),
          "customMessageText",
          val,
          getActiveTuiConfig().colored,
        ),
    });

    const panelChild: Component = {
      invalidate: () => {
        body.invalidate();
      },
      render: (width: number) => {
        const liveConfig = getActiveTuiConfig();
        const livePanel = panelRenderConfig(liveConfig);
        if (!livePanel.enabled) {
          this.removeChild(panelChild);
          panelChildMap.delete(this);
          original.call(this);
          return this.children.slice(1).flatMap((child) => child.render(width));
        }
        const theme = patch.getTheme();
        const currentPad = Reflect.get(this, "outputPad");
        const pad = typeof currentPad === "number" ? currentPad : 1;
        const innerWidth = getPanelOrFallbackInnerWidth(width, pad);
        const labelText = `[${message.customType ?? "custom"}]`;
        const lines = text ? ["", ...body.render(innerWidth)] : [];
        return renderPanelOrFallback(lines, width, pad, theme, undefined, {
          topLeftLabel: labelText,
        });
      },
    };

    panelChildMap.set(this, panelChild);
    this.addChild(panelChild);
  });
  syncPanelEnabledOnRender(prototype, (instance) => {
    const rebuild = Reflect.get(instance, "rebuild");
    if (typeof rebuild === "function") rebuild.call(instance);
  });
}

function applyUserMarkdownTransformers(
  markdown: string,
  availableWidth: number,
  transformers: readonly MarkdownTransformer[],
): string {
  let current = markdown;
  for (const transformer of transformers) {
    try {
      const next = transformer(current, {
        messageType: "user",
        isStreaming: false,
        availableWidth,
      });
      if (typeof next === "string") {
        current = next;
      }
    } catch {
      // Keep previous markdown if a transformer fails.
    }
  }
  return current;
}

/** Frame UserMessageComponent like the prompt window with firstLinePrefix cutout and verb-pack bottom-right label. */
export function installUserMessagePanel(
  getTheme: () => Theme | undefined,
  getPromptChar: () => string = sharedGetPromptChar,
): void {
  const prototype = UserMessageComponent.prototype;
  const installed = Reflect.get(prototype, USER_MESSAGE_PANEL) as
    | {
        getTheme: typeof getTheme;
        getPromptChar: typeof getPromptChar;
      }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    installed.getPromptChar = getPromptChar;
    return;
  }
  const originalRebuild = Reflect.get(prototype, "rebuild");
  if (typeof originalRebuild !== "function") return;
  const patch = { getTheme, getPromptChar };
  const steeredMap = new WeakMap<UserMessageComponent, boolean>();
  Reflect.set(prototype, USER_MESSAGE_PANEL, patch);
  Reflect.set(prototype, "rebuild", function (this: UserMessageComponent) {
    const text = Reflect.get(this, "text");
    const markdownTheme = Reflect.get(this, "markdownTheme") as
      | MarkdownTheme
      | undefined;
    if (typeof text !== "string" || !markdownTheme) {
      originalRebuild.call(this);
      return;
    }
    if (!steeredMap.has(this)) {
      const directSteer = Reflect.get(this, "steered") === true;
      const queuedSteer = consumeSteeredUserMessage(text);
      steeredMap.set(this, directSteer || queuedSteer);
    }

    const config = getActiveTuiConfig();
    const panel = panelRenderConfig(config);
    if (!panel.enabled) {
      originalRebuild.call(this);
      return;
    }

    const rawTransformers = Reflect.get(this, "markdownTransformers");
    const transformers: readonly MarkdownTransformer[] = Array.isArray(
      rawTransformers,
    )
      ? rawTransformers
      : [];

    const innerMarkdown = new Markdown(
      text,
      0,
      0,
      markdownTheme,
      {
        color: (content) =>
          safeFg(
            patch.getTheme(),
            "userMessageText",
            content,
            getActiveTuiConfig().colored,
          ),
      },
      {
        preserveOrderedListMarkers: true,
        preserveBackslashEscapes: true,
        transform: (md, availWidth) =>
          applyUserMarkdownTransformers(md, availWidth, transformers),
      },
    );

    this.clear();
    this.addChild({
      invalidate: () => innerMarkdown.invalidate(),
      render: (width: number) => {
        const liveConfig = getActiveTuiConfig();
        const livePanel = panelRenderConfig(liveConfig);
        if (!livePanel.enabled) {
          originalRebuild.call(this);
          const raw = this.children.flatMap((child) => child.render(width));
          return raw;
        }

        const theme = patch.getTheme();
        const currentPad = Reflect.get(this, "outputPad");
        const pad = typeof currentPad === "number" ? currentPad : 1;
        const isSteer =
          Reflect.get(this, "steered") === true ||
          steeredMap.get(this) === true;
        const promptChar = patch.getPromptChar() || "❯";
        const verb = resolveToolVerb(isSteer ? "steer" : "prompt", livePanel);
        const { innerWidth } = resolvePanelFrameLayout(width, {
          mode: livePanel.mode,
          borderStyle: livePanel.borderStyle,
          accentStripe: livePanel.accentStripe,
          outputPad: pad,
          colored: liveConfig.colored,
          surface: livePanel.surface,
        });
        const bodyLines = innerMarkdown.render(innerWidth);
        const lines = bodyLines.length > 0 ? bodyLines : [""];
        return framePanelLines(lines, width, theme, {
          mode: livePanel.mode,
          borderStyle: livePanel.borderStyle,
          accentStripe: livePanel.accentStripe,
          outputPad: pad,
          stateToken: "toolSuccessBg",
          includeTop: true,
          includeBottom: true,
          colored: liveConfig.colored,
          surface: livePanel.surface,
          firstLinePrefix: `${promptChar} `,
          topLeftLabel: verb.settled,
        });
      },
    });
  });

  syncPanelEnabledOnRender(
    prototype,
    (instance) => {
      const rebuild = Reflect.get(instance, "rebuild");
      if (typeof rebuild === "function") rebuild.call(instance);
    },
    (lines) => {
      if (lines.length === 0) return lines;
      if (!lines[0]?.startsWith(OSC133_ZONE_START)) {
        lines[0] = OSC133_ZONE_START + (lines[0] ?? "");
      }
      const lastIdx = lines.length - 1;
      const zoneEnd = OSC133_ZONE_END + OSC133_ZONE_FINAL;
      if (
        !lines[lastIdx]?.startsWith(zoneEnd) &&
        !lines[lastIdx]?.includes(zoneEnd)
      ) {
        lines[lastIdx] = zoneEnd + (lines[lastIdx] ?? "");
      }
      return lines;
    },
  );
}

function setLoaderPaddingX(
  instance: BashExecutionComponent,
  paddingX: number,
): void {
  const loader = Reflect.get(instance, "loader") as
    | { setPaddingX?: (paddingX: number) => void }
    | undefined;
  loader?.setPaddingX?.(paddingX);
}

function attachChildrenIfChanged(
  instance: BashExecutionComponent,
  target: readonly Component[],
): void {
  if (
    instance.children.length === target.length &&
    instance.children.every((child, idx) => child === target[idx])
  ) {
    return;
  }
  instance.clear();
  for (const child of target) {
    instance.addChild(child);
  }
}

function restoreBashHostChildren(
  instance: BashExecutionComponent,
  hostChildren: readonly Component[],
): void {
  setLoaderPaddingX(instance, 1);
  attachChildrenIfChanged(instance, hostChildren);
}

/** Reuse the host's inline shell execution lifecycle (`!` / `!!`) inside our panel frame. */
export function installBashPanel(getTheme: () => Theme | undefined): void {
  const prototype = BashExecutionComponent.prototype;
  const installed = Reflect.get(prototype, BASH_PANEL) as
    | { getTheme: typeof getTheme }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    return;
  }
  const original = Reflect.get(prototype, "updateDisplay");
  if (typeof original !== "function") return;
  const patch = { getTheme };
  const hostChildrenMap = new WeakMap<BashExecutionComponent, Component[]>();
  const panelChildrenMap = new WeakMap<BashExecutionComponent, Component[]>();
  Reflect.set(prototype, BASH_PANEL, patch);
  Reflect.set(
    prototype,
    "updateDisplay",
    function (this: BashExecutionComponent) {
      const contentContainer = Reflect.get(this, "contentContainer") as
        | Container
        | undefined;
      if (!contentContainer) {
        original.call(this);
        return;
      }

      let hostChildren = hostChildrenMap.get(this);
      if (!hostChildren) {
        hostChildren = [...this.children];
        hostChildrenMap.set(this, hostChildren);
      }

      const config = getActiveTuiConfig();
      const panel = panelRenderConfig(config);
      if (!panel.enabled) {
        restoreBashHostChildren(this, hostChildren);
        original.call(this);
        return;
      }

      setLoaderPaddingX(this, 0);
      const savedPad = Reflect.get(this, "outputPad");
      const savedColorKey = Reflect.get(this, "colorKey");
      const surfaceActive = isPanelSurfaceActive(panel.surface, config.colored);
      const overrideColorKey =
        savedColorKey === "bashMode"
          ? "accent"
          : surfaceActive && savedColorKey === "dim"
            ? "text"
            : undefined;
      if (typeof savedPad === "number") {
        Reflect.set(this, "outputPad", 0);
      }
      if (overrideColorKey !== undefined) {
        Reflect.set(this, "colorKey", overrideColorKey);
      }
      try {
        original.call(this);
      } finally {
        if (typeof savedPad === "number") {
          Reflect.set(this, "outputPad", savedPad);
        }
        if (overrideColorKey !== undefined) {
          Reflect.set(this, "colorKey", savedColorKey);
        }
      }

      let panelChildren = panelChildrenMap.get(this);
      if (!panelChildren) {
        panelChildren = [
          new Spacer(1),
          {
            invalidate: () => contentContainer.invalidate(),
            render: (width: number) => {
              const liveConfig = getActiveTuiConfig();
              const livePanel = panelRenderConfig(liveConfig);
              if (!livePanel.enabled) {
                restoreBashHostChildren(this, hostChildren);
                original.call(this);
                return this.children.flatMap((child) => child.render(width));
              }

              const theme = patch.getTheme();
              const status = Reflect.get(this, "status");
              const exitCode = Reflect.get(this, "exitCode");
              const stateToken =
                status === "running"
                  ? "toolPendingBg"
                  : status === "error" ||
                      status === "cancelled" ||
                      (typeof exitCode === "number" && exitCode !== 0)
                    ? "toolErrorBg"
                    : "toolSuccessBg";
              const currentPad = Reflect.get(this, "outputPad");
              const pad = typeof currentPad === "number" ? currentPad : 1;
              const { innerWidth } = resolvePanelFrameLayout(width, {
                mode: livePanel.mode,
                borderStyle: livePanel.borderStyle,
                accentStripe: livePanel.accentStripe,
                outputPad: pad,
                colored: liveConfig.colored,
                surface: livePanel.surface,
              });
              if (typeof currentPad === "number") {
                Reflect.set(this, "outputPad", 0);
              }
              let lines: string[];
              try {
                lines = contentContainer.render(innerWidth);
              } finally {
                if (typeof currentPad === "number") {
                  Reflect.set(this, "outputPad", currentPad);
                }
              }
              const liveSurfaceActive = isPanelSurfaceActive(
                livePanel.surface,
                liveConfig.colored,
              );
              return framePanelLines(lines, width, theme, {
                mode: livePanel.mode,
                borderStyle: livePanel.borderStyle,
                accentStripe: livePanel.accentStripe,
                outputPad: pad,
                stateToken,
                borderToken: liveSurfaceActive ? "borderAccent" : "border",
                includeTop: true,
                includeBottom: true,
                colored: liveConfig.colored,
                surface: livePanel.surface,
                firstLinePrefix: `${sharedGetPromptChar()} `,
                topLeftLabel: resolveToolVerb("bash", livePanel).settled,
              });
            },
          },
        ];
        panelChildrenMap.set(this, panelChildren);
      }
      attachChildrenIfChanged(this, panelChildren);
    },
  );
  syncPanelEnabledOnRender(prototype, (instance) => {
    const updateDisplay = Reflect.get(instance, "updateDisplay");
    if (typeof updateDisplay === "function") updateDisplay.call(instance);
  });
}
