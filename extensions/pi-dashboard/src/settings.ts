import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingsListTheme } from "@earendil-works/pi-tui";
import { roundedFrame } from "@hollowheap/tui/frame";
import type {
  DashboardConfig,
  DashboardHeaderPreset,
  DashboardSettings,
} from "./config.js";

const HEADERS: readonly DashboardHeaderPreset[] = ["banner", "none"];
const GAPS = ["0", "1", "2"];
const TOGGLES = ["on", "off"];

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
  const first = config.sections.find((section) => section.type === "header");
  return first ? "banner" : "none";
}

function currentGap(config: DashboardConfig): number {
  const first = config.sections.find((section) => section.type === "header");
  return first?.gap ?? 0;
}

function hasSection(
  config: DashboardConfig,
  type: DashboardConfig["sections"][number]["type"],
): boolean {
  return config.sections.some((section) => section.type === type);
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
      let showState = hasSection(config, "state");
      let showSessions = hasSection(config, "sessions");
      let showActions = hasSection(config, "actions");
      let autoHide = config.autoHide ?? true;

      const list = new SettingsList(
        [
          {
            id: "header",
            label: "Startup header",
            description: "Banner keeps configured ASCII art or none to hide",
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
          {
            id: "state",
            label: "Session state",
            description:
              "Show active mode, agent, model, usage, todos, and tasks",
            currentValue: showState ? "on" : "off",
            values: TOGGLES,
          },
          {
            id: "sessions",
            label: "Recent sessions",
            description: "Show resumable recent sessions for this project",
            currentValue: showSessions ? "on" : "off",
            values: TOGGLES,
          },
          {
            id: "actions",
            label: "Quick actions",
            description: "Show keyboard/command shortcut bar on startup",
            currentValue: showActions ? "on" : "off",
            values: TOGGLES,
          },
          {
            id: "auto-hide",
            label: "Auto-hide on chat",
            description:
              "Hide startup dashboard once conversation starts (reopen via /dashboard)",
            currentValue: autoHide ? "on" : "off",
            values: TOGGLES,
          },
        ],
        10,
        themeFor(theme),
        (id, value) => {
          if (id === "header") {
            header = value as DashboardHeaderPreset;
          } else if (id === "header-gap") {
            gap = Number(value);
          } else if (id === "state") {
            showState = value === "on";
          } else if (id === "sessions") {
            showSessions = value === "on";
          } else if (id === "actions") {
            showActions = value === "on";
          } else if (id === "auto-hide") {
            autoHide = value === "on";
          }
          onSave({
            header,
            gap,
            showState,
            showSessions,
            showActions,
            autoHide,
          });
          tui.requestRender();
        },
        () => done(),
        { enableSearch: true },
      );

      return {
        render(width: number): string[] {
          const innerWidth = Math.max(1, width - 4);
          const lines = [...list.render(innerWidth)];
          return roundedFrame(lines, width, theme, "Dashboard settings");
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
      overlayOptions: { width: "70%", maxHeight: "75%", margin: 1 },
    },
  );
}
