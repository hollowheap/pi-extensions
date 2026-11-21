import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/ui/frame";
import { StyledMarkdown } from "@hollowheap/ui/markdown";
import {
  getActiveTuiConfig,
  subscribeActiveTuiConfig,
} from "@hollowheap/ui/state";
import { safeFg } from "@hollowheap/ui/theme";
import { canOverlay, hostUi, notify, showDialog } from "./host.js";
import { handleViewportKey } from "./viewport.js";

export interface MarkdownPagerOptions {
  title: string;
  markdown: string;
  /** Text shown when no TUI overlay is available. */
  plainText?: string;
  fullscreen?: boolean;
  read?: () => { title: string; markdown: string };
  navigate?: (direction: -1 | 1) => void;
  /** Alt+Up or Alt+K switches to an alternate view owned by the caller. */
  onAlternateView?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const PREVIOUS_SESSION = [
  Key.alt("left"),
  Key.alt("up"),
  Key.alt("h"),
  Key.alt("k"),
];
const NEXT_SESSION = [
  Key.alt("right"),
  Key.alt("down"),
  Key.alt("l"),
  Key.alt("j"),
];

export function pagerSessionDirection(data: string): -1 | 1 | undefined {
  if (PREVIOUS_SESSION.some((key) => matchesKey(data, key))) return -1;
  if (NEXT_SESSION.some((key) => matchesKey(data, key))) return 1;
  return undefined;
}

/** Show a keyboard-scrollable Markdown overlay or fall back to a notification. */
export async function showMarkdownPager(
  ctx: ExtensionContext,
  options: MarkdownPagerOptions,
): Promise<void> {
  if (canOverlay(ctx)) {
    await withPromptLock(() =>
      showDialog<void>(
        ctx,
        (tui, theme, _keybindings, done) => {
          const liveTheme = (): Theme => hostUi(ctx)?.theme ?? theme;
          let activeTheme = liveTheme();
          let page = { title: options.title, markdown: options.markdown };
          let markdown = new StyledMarkdown(page.markdown, activeTheme, {
            colored: getActiveTuiConfig().colored,
          });
          let offset = options.fullscreen ? Number.MAX_SAFE_INTEGER : 0;
          let width = 80;
          let cachedWidth = -1;
          let content: string[] = [];
          let settled = false;

          const rebuildStyles = (): void => {
            activeTheme = liveTheme();
            markdown = new StyledMarkdown(page.markdown, activeTheme, {
              colored: getActiveTuiConfig().colored,
            });
            cachedWidth = -1;
          };
          const unsubscribe = subscribeActiveTuiConfig(() => {
            if (settled) return;
            rebuildStyles();
            tui.requestRender();
          });

          const refreshPage = (): void => {
            const updated = options.read?.();
            if (
              !updated ||
              (updated.title === page.title &&
                updated.markdown === page.markdown)
            )
              return;
            if (updated.title !== page.title || offset >= maxOffset())
              offset = Number.MAX_SAFE_INTEGER;
            page = updated;
            rebuildStyles();
            tui.requestRender();
          };

          const finish = (): void => {
            if (settled) return;
            settled = true;
            unsubscribe();
            clearInterval(timer);
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
            if (options.fullscreen) {
              const frameRows =
                getActiveTuiConfig().borderStyle === "none" ? 1 : 2;
              return Math.max(1, rows - frameRows - 1);
            }
            return Math.max(3, Math.min(rows - 4, Math.floor(rows * 0.8) - 2));
          };
          const maxOffset = (): number =>
            Math.max(
              0,
              contentLines(getFrameInnerWidth(width)).length - pageSize(),
            );
          const scrollTo = (next: number): void => {
            offset = clamp(next, 0, maxOffset());
            tui.requestRender();
          };
          const scrollBy = (delta: number): void => {
            scrollTo(offset + delta);
          };

          const timer = options.read
            ? setInterval(refreshPage, 300)
            : undefined;
          timer?.unref?.();
          return {
            capturesViewportInput: true,
            render(renderWidth: number): string[] {
              width = renderWidth;
              const innerWidth = getFrameInnerWidth(renderWidth);
              const lines = contentLines(innerWidth);
              const size = pageSize();
              offset = clamp(offset, 0, Math.max(0, lines.length - size));
              const visible = lines
                .slice(offset, offset + size)
                .map((line) => truncateToWidth(line, innerWidth, ""));
              const first = lines.length === 0 ? 0 : offset + 1;
              const last = Math.min(lines.length, offset + size);
              const coloredFooter = safeFg(
                activeTheme,
                "muted",
                `${first}-${last}/${lines.length}  ↑↓ scroll  PgUp/PgDn page  Home/End  Esc close`,
                getActiveTuiConfig().colored,
              );
              if (options.fullscreen) {
                while (visible.length < size) visible.push("");
              }
              const navigation = options.navigate
                ? "  Alt+arrows/HJKL sessions"
                : "";
              const footer = truncateToWidth(
                coloredFooter + navigation,
                innerWidth,
                "",
              );
              return boxFrame(
                [...visible, footer],
                renderWidth,
                activeTheme,
                page.title,
              );
            },
            invalidate(): void {
              rebuildStyles();
              tui.requestRender();
            },
            handleInput(data: string): void {
              if (
                options.onAlternateView &&
                (matchesKey(data, Key.alt("up")) ||
                  matchesKey(data, Key.alt("k")))
              ) {
                options.onAlternateView();
                refreshPage();
                return;
              }
              const direction = options.navigate
                ? pagerSessionDirection(data)
                : undefined;
              if (direction !== undefined) {
                options.navigate?.(direction);
                refreshPage();
                return;
              }
              handleViewportKey(data, {
                onClose: finish,
                onScrollBy: scrollBy,
                onScrollTo: scrollTo,
                pageSize,
                maxOffset,
                pagerKeys: true,
              });
            },
            dispose(): void {
              finish();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: options.fullscreen
            ? { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 }
            : { width: "90%", maxHeight: "80%", margin: 1 },
        },
      ),
    );
    return;
  }

  if (ctx.hasUI && typeof hostUi(ctx)?.notify === "function") {
    notify(ctx, options.plainText ?? options.markdown, "info");
  }
}
