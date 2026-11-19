import {
  type ParsedSkillBlock,
  SkillInvocationMessageComponent,
  type Theme,
  keyText,
  parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Text } from "@earendil-works/pi-tui";
import { getActiveTuiConfig } from "@hollowheap/tui/state";
import {
  framePanelLines,
  getPanelInnerWidth,
  panelRenderConfig,
} from "./panel.js";

const SKILL_PANEL = Symbol.for("@hollowheap/pi-modal/skill-panel");

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
  Reflect.set(prototype, SKILL_PANEL, patch);
  Reflect.set(
    prototype,
    "updateDisplay",
    function (this: SkillInvocationMessageComponent) {
      const first = Reflect.get(this, "skillBlock") as
        | ParsedSkillBlock
        | undefined;
      const expanded = Reflect.get(this, "expanded");
      const markdownTheme = Reflect.get(this, "markdownTheme");
      if (!first || typeof expanded !== "boolean" || !markdownTheme) {
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
      this.setBgFn(undefined);
      this.addChild(
        new MouseRegion(
          {
            invalidate: () => body?.invalidate(),
            render: (width) => {
              const config = getActiveTuiConfig();
              const panel = panelRenderConfig(config);
              const theme = patch.getTheme();
              const border =
                panel.mode === "background" ? "none" : panel.borderStyle;
              const innerWidth = panel.enabled
                ? getPanelInnerWidth(width, border, panel.accentStripe, 0)
                : width;
              const hintText =
                config.colored && theme ? theme.fg("dim", hint) : hint;
              header.setText(`${names} (${hintText})`);
              const lines = [
                ...header.render(innerWidth),
                ...(body?.render(innerWidth) ?? []),
              ];
              if (!panel.enabled) return lines;
              return framePanelLines(lines, width, theme, {
                mode: panel.mode,
                borderStyle: panel.borderStyle,
                accentStripe: panel.accentStripe,
                outputPad: 0,
                stateToken: "toolSuccessBg",
                includeTop: true,
                includeBottom: true,
                colored: config.colored,
                surface: panel.surface,
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
    },
  );
}
