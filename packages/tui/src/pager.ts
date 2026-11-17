import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { roundedFrame } from "./frame.js";
import { getActiveTuiConfig, subscribeActiveTuiConfig } from "./state.js";

export interface MarkdownPagerOptions {
  title: string;
  markdown: string;
  /** Text shown when no TUI overlay is available. */
  plainText?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pagerMarkdownTheme(theme: Theme, colored: boolean): MarkdownTheme {
  const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
    colored ? theme.fg(token, text) : text;
  return {
    heading: (text) => fg("accent", theme.bold(text)),
    link: (text) => fg("accent", text),
    linkUrl: (text) => fg("dim", text),
    code: (text) => fg("toolOutput", text),
    codeBlock: (text) => fg("toolOutput", text),
    codeBlockBorder: (text) => fg("border", text),
    quote: (text) => fg("muted", text),
    quoteBorder: (text) => fg("border", text),
    hr: (text) => fg("border", text),
    listBullet: (text) => fg("accent", text),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
    strikethrough: (text) => theme.strikethrough(text),
    underline: (text) => theme.underline(text),
  };
}

/** Show a keyboard-scrollable Markdown overlay or fall back to a notification. */
export async function showMarkdownPager(
  ctx: ExtensionContext,
  options: MarkdownPagerOptions,
): Promise<void> {
  if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
    await withPromptLock(() =>
      ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          const liveTheme = (): Theme =>
            (ctx.ui as { theme?: Theme } | undefined)?.theme ?? theme;
          let activeTheme = liveTheme();
          let markdown = new Markdown(
            options.markdown,
            0,
            0,
            pagerMarkdownTheme(activeTheme, getActiveTuiConfig().colored),
          );
          let offset = 0;
          let width = 80;
          let cachedWidth = -1;
          let content: string[] = [];
          let settled = false;

          const rebuildStyles = (): void => {
            activeTheme = liveTheme();
            markdown = new Markdown(
              options.markdown,
              0,
              0,
              pagerMarkdownTheme(activeTheme, getActiveTuiConfig().colored),
            );
            cachedWidth = -1;
          };
          const unsubscribe = subscribeActiveTuiConfig(() => {
            if (settled) return;
            rebuildStyles();
            tui.requestRender();
          });

          const finish = (): void => {
            if (settled) return;
            settled = true;
            unsubscribe();
            done();
          };

          const contentLines = (renderWidth: number): string[] => {
            if (cachedWidth !== renderWidth) {
              content = markdown.render(renderWidth);
              cachedWidth = renderWidth;
            }
            return content;
          };
          const pageSize = (): number => {
            const rows = tui.terminal.rows;
            return Math.max(3, Math.min(rows - 4, Math.floor(rows * 0.8) - 2));
          };
          const maxOffset = (): number =>
            Math.max(
              0,
              contentLines(Math.max(1, width - 4)).length - pageSize(),
            );
          const scrollTo = (next: number): void => {
            offset = clamp(next, 0, maxOffset());
            tui.requestRender();
          };
          const scrollBy = (delta: number): void => {
            scrollTo(offset + delta);
          };

          return {
            capturesViewportInput: true,
            render(renderWidth: number): string[] {
              width = renderWidth;
              const innerWidth = Math.max(1, renderWidth - 4);
              const lines = contentLines(innerWidth);
              const size = pageSize();
              offset = clamp(offset, 0, Math.max(0, lines.length - size));
              const visible = lines
                .slice(offset, offset + size)
                .map((line) => truncateToWidth(line, innerWidth, ""));
              const first = lines.length === 0 ? 0 : offset + 1;
              const last = Math.min(lines.length, offset + size);
              const coloredFooter = getActiveTuiConfig().colored
                ? activeTheme.fg(
                    "muted",
                    `${first}-${last}/${lines.length}  ↑↓ scroll  PgUp/PgDn page  Home/End  Esc close`,
                  )
                : `${first}-${last}/${lines.length}  ↑↓ scroll  PgUp/PgDn page  Home/End  Esc close`;
              const footer = truncateToWidth(coloredFooter, innerWidth, "");
              return roundedFrame(
                [...visible, footer],
                renderWidth,
                activeTheme,
                options.title,
              );
            },
            invalidate(): void {
              rebuildStyles();
              tui.requestRender();
            },
            handleInput(data: string): void {
              if (
                matchesKey(data, Key.escape) ||
                matchesKey(data, Key.ctrl("c")) ||
                data === "q"
              ) {
                finish();
                return;
              }
              if (matchesKey(data, Key.up) || data === "k") {
                scrollBy(-1);
                return;
              }
              if (matchesKey(data, Key.down) || data === "j") {
                scrollBy(1);
                return;
              }
              if (matchesKey(data, Key.pageUp) || data === "b") {
                scrollBy(-pageSize());
                return;
              }
              if (
                matchesKey(data, Key.pageDown) ||
                matchesKey(data, Key.space) ||
                data === "f"
              ) {
                scrollBy(pageSize());
                return;
              }
              if (matchesKey(data, Key.home) || data === "g") {
                scrollTo(0);
                return;
              }
              if (matchesKey(data, Key.end) || data === "G") {
                scrollTo(maxOffset());
              }
            },
            dispose(): void {
              finish();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            width: "90%",
            maxHeight: "80%",
            margin: 1,
          },
        },
      ),
    );
    return;
  }

  if (ctx.hasUI && typeof ctx.ui.notify === "function") {
    ctx.ui.notify(options.plainText ?? options.markdown, "info");
  }
}
