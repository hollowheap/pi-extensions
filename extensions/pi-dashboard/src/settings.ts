import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  SettingsList,
  type SettingsListTheme,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type {
  DashboardConfig,
  DashboardHeaderPreset,
  DashboardSettings,
} from "./config.js";

const HEADERS: readonly DashboardHeaderPreset[] = ["banner", "version", "none"];
const GAPS = ["0", "1", "2"];

function themeFor(theme: Theme): SettingsListTheme {
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

function currentHeader(config: DashboardConfig): DashboardHeaderPreset {
  const first = config.sections.find(
    (section) => section.type === "header" || section.type === "version",
  );
  if (first?.type === "version") return "version";
  if (first?.type === "header") return "banner";
  return "none";
}

function currentGap(config: DashboardConfig): number {
  const first = config.sections.find(
    (section) => section.type === "header" || section.type === "version",
  );
  return first?.gap ?? 0;
}

export async function showDashboardSettings(
  ctx: ExtensionContext,
  config: DashboardConfig,
  onSave: (settings: DashboardSettings) => void,
): Promise<void> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return;

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let header = currentHeader(config);
      let gap = currentGap(config);
      const list = new SettingsList(
        [
          {
            id: "header",
            label: "Startup header",
            description:
              "Banner keeps the configured art; version shows Pi v<version>",
            currentValue: header,
            values: [...HEADERS],
          },
          {
            id: "header-gap",
            label: "Header gap",
            description: "Blank lines after the startup header",
            currentValue: String(gap),
            values: GAPS,
          },
        ],
        10,
        themeFor(theme),
        (id, value) => {
          if (id === "header") {
            header = value as DashboardHeaderPreset;
          } else {
            gap = Number(value);
          }
          onSave({ header, gap });
          tui.requestRender();
        },
        () => done(),
        { enableSearch: true },
      );

      return {
        render(width: number): string[] {
          return [
            theme.fg("accent", theme.bold("Dashboard settings")),
            "",
            ...list.render(width),
          ].map((line) => truncateToWidth(line, width, ""));
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
}
