import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { session } from "@hollowheap/core/state";
import { roundedFrame } from "@hollowheap/tui/frame";
import type { AgentConfig } from "./agents.js";

export interface ForkInfo {
  sessionName?: string;
  forked: boolean;
}

export async function showAgentSwitchPopup(
  agent: AgentConfig,
  ctx: ExtensionContext,
  forkInfo?: ForkInfo,
): Promise<void> {
  const effectiveMode = agent.mode ?? session(ctx.sessionManager).mode;
  if (ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
    await ctx.ui.custom<void>(
      (_tui, theme, _keybindings, done) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          done();
        };

        const label = (value: string) => theme.fg("muted", value);
        const contentLines = [
          `${label("  Mode:     ")}${effectiveMode}`,
          `${label("  Model:    ")}${agent.model ?? "default"}`,
          `${label("  Effort:   ")}${agent.thinking ?? agent.effort ?? "default"}`,
          `${label("  Tools:    ")}${agent.tools ? agent.tools.join(", ") : "all"}`,
          `${label("  Skills:   ")}${agent.skills ? agent.skills.join(", ") : "all workspace"}`,
          forkInfo?.forked
            ? `${label("  Branch:   ")}${forkInfo.sessionName ?? agent.name} (forked)`
            : `${label("  Session:  ")}${forkInfo?.sessionName ?? "active"}`,
          "",
          theme.fg("dim", "  [Press Enter, Space, or Esc to close]"),
        ];

        return {
          render(width: number): string[] {
            return roundedFrame(
              contentLines,
              width,
              theme,
              `Agent Activated: ${agent.name}`,
            );
          },
          invalidate(): void {},
          handleInput(data: string): void {
            if (
              matchesKey(data, Key.enter) ||
              matchesKey(data, Key.space) ||
              matchesKey(data, Key.escape) ||
              matchesKey(data, Key.ctrl("c"))
            ) {
              finish();
            }
          },
        };
      },
      { overlay: true },
    );
  } else if (typeof ctx.ui?.confirm === "function") {
    const forkMsg = forkInfo?.forked
      ? ` (Forked into: ${forkInfo.sessionName})`
      : "";
    await ctx.ui.confirm(
      `Agent: ${agent.name}`,
      `Mode: ${effectiveMode} | Model: ${agent.model ?? "default"} | Tools: ${agent.tools ? agent.tools.join(", ") : "all"}${forkMsg}`,
    );
  } else {
    ctx.ui?.notify?.(
      `Switched to agent "${agent.name}"${forkInfo?.forked ? " (forked session)" : ""}`,
      "info",
    );
  }
}
