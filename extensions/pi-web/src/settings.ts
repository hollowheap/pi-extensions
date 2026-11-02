import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  SettingsList,
  type SettingsListTheme,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { WebConfig, WebSettings } from "./config.js";
import { FETCH_ORDER, SEARCH_ORDER } from "./providers/selection.js";
import type { FetchProvider, ProviderId } from "./providers/types.js";

const SEARCH_VALUES = ["default", ...SEARCH_ORDER];
const FETCH_VALUES = ["default", ...FETCH_ORDER];

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

function searchOrder(value: string): ProviderId[] | undefined {
  if (value === "default") return undefined;
  return [
    value as ProviderId,
    ...SEARCH_ORDER.filter((provider) => provider !== value),
  ];
}

function fetchOrder(value: string): FetchProvider[] | undefined {
  if (value === "default") return undefined;
  return [
    value as FetchProvider,
    ...FETCH_ORDER.filter((provider) => provider !== value),
  ];
}

export async function showWebSettings(
  ctx: ExtensionContext,
  config: WebConfig,
  onSave: (settings: WebSettings) => void,
): Promise<void> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return;

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let current = config;
      const list = new SettingsList(
        [
          {
            id: "search-provider",
            label: "Search preference",
            description:
              "Provider tried first; default keeps the configured order",
            currentValue: current.searchOrder?.[0] ?? "default",
            values: SEARCH_VALUES,
          },
          {
            id: "fetch-provider",
            label: "Fetch preference",
            description:
              "Provider tried first; raw is the final direct-fetch fallback",
            currentValue: current.fetchOrder?.[0] ?? "default",
            values: FETCH_VALUES,
          },
        ],
        10,
        themeFor(theme),
        (id, value) => {
          if (id === "search-provider") {
            current = { ...current, searchOrder: searchOrder(value) };
          } else {
            current = { ...current, fetchOrder: fetchOrder(value) };
          }
          onSave({
            searchOrder: current.searchOrder,
            fetchOrder: current.fetchOrder,
          });
          tui.requestRender();
        },
        () => done(),
        { enableSearch: true },
      );

      return {
        render(width: number): string[] {
          return [
            theme.fg("accent", theme.bold("Web settings")),
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
