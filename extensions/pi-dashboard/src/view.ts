import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import {
  type SessionSnapshot,
  getSessionSnapshot,
  subscribeSessionSnapshot,
} from "@hollowheap/core/snapshot";
import { roundedFrame } from "@hollowheap/tui/frame";
import {
  DEFAULT_DASHBOARD_ACTIONS,
  type StateRenderInput,
  renderActionsSection,
  renderSessionsSection,
  renderStateSection,
} from "./sections.js";
import type { DashboardSessionItem } from "./sessions.js";

export type DashboardViewResult =
  | { type: "close" }
  | { type: "resume"; session: DashboardSessionItem }
  | { type: "command"; command: string }
  | { type: "settings" };

export interface DashboardOverlayOptions {
  loadSessions: (scope: "cwd" | "all") => Promise<DashboardSessionItem[]>;
  initialSessions?: DashboardSessionItem[];
  initialScope?: "cwd" | "all";
  maxItems?: number;
  getStateInput: () => Omit<StateRenderInput, "snapshot">;
  snapshotOwner: unknown;
}

export async function showDashboardOverlay(
  ctx: ExtensionContext,
  options: DashboardOverlayOptions,
): Promise<DashboardViewResult> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return { type: "close" };
  }

  return await ctx.ui.custom<DashboardViewResult>(
    (tui, theme: Theme, _keybindings, done) => {
      const maxItems = Math.max(1, Math.min(20, options.maxItems ?? 8));
      const maxKey = Math.min(maxItems, 9);
      let scope: "cwd" | "all" = options.initialScope ?? "cwd";
      let sessions: DashboardSessionItem[] = options.initialSessions ?? [];
      let selectedIndex = 0;
      let loading = options.initialSessions === undefined;
      let closed = false;
      let snapshot: SessionSnapshot = getSessionSnapshot(options.snapshotOwner);

      const unsubscribe = subscribeSessionSnapshot(
        options.snapshotOwner,
        (next) => {
          snapshot = next;
          if (!closed) tui.requestRender();
        },
      );

      const finish = (result: DashboardViewResult) => {
        if (closed) return;
        closed = true;
        unsubscribe();
        done(result);
      };

      const reload = () => {
        loading = true;
        const targetScope = scope;
        void options
          .loadSessions(targetScope)
          .then((loaded) => {
            if (closed || scope !== targetScope) return;
            sessions = loaded;
            selectedIndex =
              sessions.length === 0
                ? 0
                : Math.min(selectedIndex, sessions.length - 1);
            loading = false;
            tui.requestRender();
          })
          .catch(() => {
            if (closed) return;
            loading = false;
            tui.requestRender();
          });
      };

      if (options.initialSessions === undefined) {
        reload();
      }

      return {
        render(width: number): string[] {
          const innerWidth = Math.max(20, width - 4);
          const stateBase = options.getStateInput();
          const lines: string[] = [];

          lines.push(
            ...renderStateSection(
              { ...stateBase, snapshot },
              theme,
              innerWidth,
              "left",
            ),
          );
          lines.push("");

          if (loading && sessions.length === 0) {
            lines.push(theme.bold(theme.fg("accent", "Recent Sessions")));
            lines.push(`  ${theme.fg("dim", "Loading sessions...")}`);
          } else {
            lines.push(
              ...renderSessionsSection(sessions, theme, innerWidth, {
                maxItems,
                selectedIndex,
                showHint: true,
              }),
            );
          }

          const scopeText = scope === "cwd" ? "project" : "all workspaces";
          lines.push(
            `  ${theme.fg("dim", `Scope: ${scopeText} (Tab toggle)`)}`,
          );
          lines.push("");

          lines.push(
            ...renderActionsSection(
              DEFAULT_DASHBOARD_ACTIONS.filter((item) => item.key !== "d"),
              theme,
              innerWidth,
              "left",
            ),
          );
          lines.push("");
          lines.push(
            theme.fg(
              "dim",
              `Enter/1-${maxKey} resume · Tab scope · r refresh · s settings · q/Esc close`,
            ),
          );

          return roundedFrame(lines, width, theme, "Dashboard");
        },

        handleInput(data: string): void {
          if (
            matchesKey(data, Key.escape) ||
            matchesKey(data, Key.ctrl("c")) ||
            data === "q"
          ) {
            finish({ type: "close" });
            return;
          }
          if (matchesKey(data, Key.up) || data === "k") {
            if (sessions.length > 0) {
              selectedIndex =
                (selectedIndex - 1 + sessions.length) % sessions.length;
              tui.requestRender();
            }
            return;
          }
          if (matchesKey(data, Key.down) || data === "j") {
            if (sessions.length > 0) {
              selectedIndex = (selectedIndex + 1) % sessions.length;
              tui.requestRender();
            }
            return;
          }
          if (matchesKey(data, Key.enter)) {
            const picked = sessions[selectedIndex];
            if (picked) finish({ type: "resume", session: picked });
            return;
          }
          if (matchesKey(data, Key.tab)) {
            scope = scope === "cwd" ? "all" : "cwd";
            selectedIndex = 0;
            reload();
            tui.requestRender();
            return;
          }
          if (data === "r") {
            reload();
            tui.requestRender();
            return;
          }
          if (data === "s") {
            finish({ type: "settings" });
            return;
          }
          if (data >= "1" && data <= String(maxKey)) {
            const idx = Number(data) - 1;
            const picked = sessions[idx];
            if (picked) finish({ type: "resume", session: picked });
            return;
          }
          const matched = DEFAULT_DASHBOARD_ACTIONS.find(
            (item) => item.key === data && item.key !== "d" && item.key !== "s",
          );
          if (matched) {
            finish({ type: "command", command: matched.command });
          }
        },

        invalidate(): void {},
        dispose(): void {
          closed = true;
          unsubscribe();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "80%", maxHeight: "85%", margin: 1 },
    },
  );
}
