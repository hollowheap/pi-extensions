import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";

export interface MarkdownPagerOptions {
  title: string;
  markdown: string;
  /** Text shown when no TUI overlay is available. */
  plainText?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pagerMarkdownTheme(theme: Theme): MarkdownTheme {
  return {
    heading: (text) => theme.fg("accent", theme.bold(text)),
    link: (text) => theme.fg("accent", text),
    linkUrl: (text) => theme.fg("dim", text),
    code: (text) => theme.fg("toolOutput", text),
    codeBlock: (text) => theme.fg("toolOutput", text),
    codeBlockBorder: (text) => theme.fg("border", text),
    quote: (text) => theme.fg("muted", text),
    quoteBorder: (text) => theme.fg("border", text),
    hr: (text) => theme.fg("border", text),
    listBullet: (text) => theme.fg("accent", text),
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
          const markdown = new Markdown(
            options.markdown,
            0,
            0,
            pagerMarkdownTheme(theme),
          );
          let offset = 0;
          let width = 80;
          let cachedWidth = -1;
          let content: string[] = [];

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
            Math.max(0, contentLines(width).length - pageSize());
          const scrollTo = (next: number): void => {
            offset = clamp(next, 0, maxOffset());
            tui.requestRender();
          };
          const scrollBy = (delta: number): void => {
            scrollTo(offset + delta);
          };

          return {
            render(renderWidth: number): string[] {
              width = renderWidth;
              const lines = contentLines(renderWidth);
              const size = pageSize();
              offset = clamp(offset, 0, Math.max(0, lines.length - size));
              const visible = lines
                .slice(offset, offset + size)
                .map((line) => truncateToWidth(line, renderWidth, ""));
              const header = truncateToWidth(
                theme.fg("accent", theme.bold(options.title)),
                renderWidth,
                "",
              );
              const first = lines.length === 0 ? 0 : offset + 1;
              const last = Math.min(lines.length, offset + size);
              const footer = truncateToWidth(
                theme.fg(
                  "muted",
                  `${first}-${last}/${lines.length}  ↑↓ scroll  PgUp/PgDn page  Home/End  Esc close`,
                ),
                renderWidth,
                "",
              );
              return [header, ...visible, footer];
            },
            invalidate(): void {
              cachedWidth = -1;
            },
            handleInput(data: string): void {
              if (
                matchesKey(data, Key.escape) ||
                matchesKey(data, Key.ctrl("c")) ||
                data === "q"
              ) {
                done();
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
