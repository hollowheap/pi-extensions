import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  decodeKittyPrintable,
  fuzzyFilter,
  matchesKey,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import type { AgentConfig } from "./agents.js";
import { roundedFrame } from "./frame.js";

interface AgentPickerItem extends SelectItem {
  agent?: AgentConfig;
}

function selectTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("muted", text),
    noMatch: (text) => theme.fg("muted", text),
  };
}

function printableKey(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if (data.length !== 1) return undefined;
  const code = data.charCodeAt(0);
  return code >= 32 && code !== 127 ? data : undefined;
}

function agentItems(agents: readonly AgentConfig[]): AgentPickerItem[] {
  return [
    {
      value: "default",
      label: "(default)",
      description: "Reset to default agent",
    },
    ...agents.map((agent) => ({
      value: agent.name,
      label: agent.name,
      description: agent.description,
      agent,
    })),
  ];
}

export async function showAgentPicker(
  ctx: ExtensionContext,
  agents: readonly AgentConfig[],
): Promise<string | undefined> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return undefined;
  }

  const allItems = agentItems(agents);
  return withPromptLock(() =>
    ctx.ui.custom<string | undefined>(
      (tui, theme, _keybindings, done) => {
        let query = "";
        let settled = false;
        let selected: AgentPickerItem | undefined;
        let list: SelectList;

        const finish = (value: string | undefined): void => {
          if (settled) return;
          settled = true;
          done(value);
        };

        const rebuild = (): void => {
          const filtered = query
            ? fuzzyFilter(
                allItems,
                query,
                (item) =>
                  `${item.label} ${item.description ?? ""} ${item.agent?.model ?? ""}`,
              )
            : allItems;
          list = new SelectList(
            filtered,
            Math.max(3, Math.min(filtered.length, 7)),
            selectTheme(theme),
          );
          list.onSelectionChange = (item) => {
            selected = item as AgentPickerItem;
            tui.requestRender();
          };
          list.onSelect = (item) => finish(item.value);
          list.onCancel = () => finish(undefined);
          selected =
            (list.getSelectedItem() as AgentPickerItem | null) ?? undefined;
        };

        const preview = (): string[] => {
          if (!selected) return [theme.fg("muted", "No matching agents")];
          if (!selected.agent) {
            return [theme.fg("accent", theme.bold("Default agent"))];
          }
          const agent = selected.agent;
          return [
            theme.fg("accent", theme.bold(agent.description)),
            theme.fg(
              "muted",
              `model: ${agent.model ?? "default"}  mode: ${agent.mode ?? "ask"}  thinking: ${agent.thinking ?? agent.effort ?? "default"}`,
            ),
            theme.fg("muted", `tools: ${agent.tools?.join(", ") ?? "all"}`),
            theme.fg(
              "muted",
              `skills: ${agent.skills?.join(", ") ?? "all workspace"}`,
            ),
            theme.fg("dim", `source: ${agent.source}`),
          ];
        };

        rebuild();
        return {
          render(width: number): string[] {
            const lines = [
              theme.fg(
                "muted",
                query === "" ? "Filter: (type to search)" : `Filter: ${query}`,
              ),
              ...list.render(Math.max(1, width - 4)),
              "",
              ...preview(),
              "",
              theme.fg(
                "dim",
                "↑↓ move  Enter select  Esc cancel  type to filter",
              ),
            ];
            return roundedFrame(lines, width, theme, "Select an agent");
          },
          invalidate(): void {
            list.invalidate();
          },
          handleInput(data: string): void {
            if (matchesKey(data, Key.backspace)) {
              if (query !== "") {
                query = query.slice(0, -1);
                rebuild();
                tui.requestRender();
              }
              return;
            }
            const printable = printableKey(data);
            if (printable !== undefined) {
              query += printable;
              rebuild();
              tui.requestRender();
              return;
            }
            list.handleInput(data);
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: "70%",
          maxHeight: "75%",
          margin: 1,
        },
      },
    ),
  );
}
