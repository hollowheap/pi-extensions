import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  if (ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
    await ctx.ui.custom<void>(
      (_tui, theme, _keybindings, done) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          done();
        };

        const title = ` Agent Activated: ${agent.name} `;
        const modeText = `  Mode:     ${agent.mode ?? "ask"}`;
        const modelText = `  Model:    ${agent.model ?? "default"}`;
        const effortText = `  Effort:   ${agent.thinking ?? agent.effort ?? "default"}`;
        const toolsText = `  Tools:    ${agent.tools ? agent.tools.join(", ") : "all"}`;
        const skillsText = `  Skills:   ${agent.skills ? agent.skills.join(", ") : "all workspace"}`;
        const sessionText = forkInfo?.forked
          ? `  Branch:   ${forkInfo.sessionName ?? agent.name} (forked)`
          : `  Session:  ${forkInfo?.sessionName ?? "active"}`;
        const footerText = "  [Press Enter, Space, or Esc to close]";

        const contentLines = [
          title,
          `  ${"─".repeat(Math.max(title.length + 4, 46))}`,
          modeText,
          modelText,
          effortText,
          toolsText,
          skillsText,
          sessionText,
          "",
          footerText,
        ];

        return {
          render(_width: number): string[] {
            const borderFn = (s: string) =>
              typeof theme?.fg === "function" ? theme.fg("border", s) : s;
            const accentFn = (s: string) =>
              typeof theme?.fg === "function" ? theme.fg("accent", s) : s;

            const maxLen = Math.max(...contentLines.map((l) => l.length)) + 2;
            const top = borderFn(`╭${"─".repeat(maxLen)}╮`);
            const bot = borderFn(`╰${"─".repeat(maxLen)}╯`);

            const middle = contentLines.map((line, idx) => {
              const padded = line.padEnd(maxLen, " ");
              const styled =
                idx === 0 || idx === contentLines.length - 1
                  ? accentFn(padded)
                  : padded;
              return `${borderFn("│")}${styled}${borderFn("│")}`;
            });

            return [top, ...middle, bot];
          },
          invalidate(): void {},
          handleInput(data: string): void {
            if (
              data === "\r" ||
              data === "\n" ||
              data === " " ||
              data === "\x1b"
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
      `Mode: ${agent.mode ?? "ask"} | Model: ${agent.model ?? "default"} | Tools: ${agent.tools ? agent.tools.join(", ") : "all"}${forkMsg}`,
    );
  } else {
    ctx.ui?.notify?.(
      `Switched to agent "${agent.name}"${forkInfo?.forked ? " (forked session)" : ""}`,
      "info",
    );
  }
}
