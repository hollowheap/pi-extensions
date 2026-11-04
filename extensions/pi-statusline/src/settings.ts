import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  SettingsList,
  type SettingsListTheme,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core";
import type { StatuslineConfig } from "./config.js";

const SEPARATORS = [
  { value: "space", label: "space", text: " " },
  { value: "pipe", label: "pipe", text: " | " },
  { value: "dot", label: "dot", text: " · " },
] as const;

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

function separatorValue(text: string): string {
  return SEPARATORS.find((entry) => entry.text === text)?.value ?? "custom";
}

function applySetting(
  config: StatuslineConfig,
  id: string,
  value: string,
): StatuslineConfig {
  const options = { ...config.options };
  if (id === "component-separator") {
    const separator = SEPARATORS.find((entry) => entry.value === value);
    if (separator) {
      options.componentSeparator = {
        ...config.options.componentSeparator,
        text: separator.text,
      };
    }
  } else if (id === "section-separator") {
    const separator = SEPARATORS.find((entry) => entry.value === value);
    if (separator) {
      options.sectionSeparator = {
        ...config.options.sectionSeparator,
        text: separator.text,
      };
    }
  }
  return { ...config, options };
}

export async function showStatuslineSettings(
  ctx: ExtensionContext,
  config: StatuslineConfig,
  onChange: (next: StatuslineConfig) => void,
): Promise<void> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return;
  }

  await withPromptLock(() =>
    ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        let current = config;
        const list = new SettingsList(
          [
            {
              id: "component-separator",
              label: "Component separator",
              description: "Text between components in a section",
              currentValue: separatorValue(
                current.options.componentSeparator.text,
              ),
              values: SEPARATORS.map((entry) => entry.value),
            },
            {
              id: "section-separator",
              label: "Section separator",
              description: "Text between left and right sections",
              currentValue: separatorValue(
                current.options.sectionSeparator.text,
              ),
              values: SEPARATORS.map((entry) => entry.value),
            },
          ],
          10,
          settingsTheme(theme),
          (id, value) => {
            current = applySetting(current, id, value);
            onChange(current);
            tui.requestRender();
          },
          () => done(),
          { enableSearch: true },
        );

        return {
          render(width: number): string[] {
            return [
              theme.fg("accent", theme.bold("Statusline settings")),
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
        overlayOptions: {
          width: "70%",
          maxHeight: "70%",
          margin: 1,
        },
      },
    ),
  );
}
