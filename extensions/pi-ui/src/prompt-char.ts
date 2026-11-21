import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { getActiveTuiConfig } from "@hollowheap/ui/state";

export const DEFAULT_PROMPT_CHAR = DEFAULT_TUI_CONFIG.promptChar;

export function getPromptChar(): string {
  return getActiveTuiConfig().promptChar;
}
