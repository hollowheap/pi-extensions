import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import { getFrameInnerWidth, roundedFrame } from "@hollowheap/tui/frame";

const NO_DEFAULT = "(default)";

function settingsTheme(theme: Theme): SettingsListTheme {
  return {
    label: (text, selected) =>
      selected ? theme.fg("accent", text) : theme.fg("text", text),
    value: (text, selected) =>
      selected ? theme.fg("accent", text) : theme.fg("muted", text),
    description: (text) => theme.fg("muted", text),
    cursor: theme.fg("accent", "› "),
    hint: (text) => theme.fg("dim", text),
  };
}

export interface ShowAgentSettingsOptions {
  agents: readonly { name: string; description?: string }[];
  currentDefault?: string;
  onSave: (name: string | undefined) => void;
}

export async function showAgentSettings(
  ctx: ExtensionContext,
  options: ShowAgentSettingsOptions,
): Promise<boolean> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return false;

  let saved = false;
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let value = options.currentDefault ?? NO_DEFAULT;
      const items: SettingItem[] = [
        {
          id: "defaultAgent",
          label: "Default agent",
          description:
            "Agent applied automatically at the start of new sessions",
          currentValue: value,
          values: [NO_DEFAULT, ...options.agents.map((agent) => agent.name)],
        },
      ];
      const list = new SettingsList(
        items,
        8,
        settingsTheme(theme),
        (_id, next) => {
          value = next;
          try {
            options.onSave(value === NO_DEFAULT ? undefined : value);
            saved = true;
          } catch (error) {
            ctx.ui?.notify?.(
              `pi-agent: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
          }
          tui.requestRender();
        },
        () => done(),
        { enableSearch: true },
      );
      return {
        render(width: number): string[] {
          const lines = [
            `Default: ${value}`,
            "",
            ...list.render(getFrameInnerWidth(width)),
          ];
          return roundedFrame(lines, width, theme, "Agent settings");
        },
        handleInput(data: string): void {
          list.handleInput(data);
        },
        invalidate(): void {
          list.invalidate();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "70%", maxHeight: "70%", margin: 1 },
    },
  );
  return saved;
}
