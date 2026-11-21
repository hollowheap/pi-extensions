import {
  type CustomToolVerb,
  DEFAULT_TUI_CONFIG,
  type OverlaySurfaceMode,
  type PanelConfig,
  type ToolVerbPack,
  type ToolVerbosity,
  type TuiConfig,
} from "@hollowheap/core/tui-config";

export const VERB_PACKS: Readonly<
  Record<ToolVerbPack, Readonly<Record<string, CustomToolVerb>>>
> = {
  standard: {
    read: { active: "Reading...", settled: "Read" },
    edit: { active: "Editing...", settled: "Edited" },
    write: { active: "Writing...", settled: "Wrote" },
    bash: { active: "Running...", settled: "Ran" },
    grep: { active: "Searching...", settled: "Searched" },
    find: { active: "Finding...", settled: "Found" },
    ls: { active: "Listing...", settled: "Listed" },
    web_search: { active: "Searching web...", settled: "Searched web" },
    fetch_url: { active: "Fetching...", settled: "Fetched" },
    codemode: { active: "Executing...", settled: "Executed" },
    prompt: { active: "Prompting...", settled: "Prompted" },
    steer: { active: "Steering...", settled: "Steered" },
  },
  terse: {
    read: { active: "read...", settled: "read" },
    edit: { active: "edit...", settled: "edit" },
    write: { active: "write...", settled: "write" },
    bash: { active: "bash...", settled: "bash" },
    grep: { active: "grep...", settled: "grep" },
    find: { active: "find...", settled: "find" },
    ls: { active: "ls...", settled: "ls" },
    web_search: { active: "search...", settled: "search" },
    fetch_url: { active: "fetch...", settled: "fetch" },
    codemode: { active: "code...", settled: "code" },
    prompt: { active: "prompt...", settled: "prompt" },
    steer: { active: "steer...", settled: "steer" },
  },
  playful: {
    read: { active: "Perusing...", settled: "Perused" },
    edit: { active: "Sculpting...", settled: "Sculpted" },
    write: { active: "Inscribing...", settled: "Inscribed" },
    bash: { active: "Conjuring...", settled: "Conjured" },
    grep: { active: "Hunting...", settled: "Hunted" },
    find: { active: "Seeking...", settled: "Sought" },
    ls: { active: "Surveying...", settled: "Surveyed" },
    web_search: { active: "Foraging...", settled: "Foraged" },
    fetch_url: { active: "Reeling in...", settled: "Reeled in" },
    codemode: { active: "Weaving...", settled: "Woven" },
    prompt: { active: "Asking...", settled: "Asked" },
    steer: { active: "Nudging...", settled: "Nudged" },
  },
};

export type PanelRenderConfig = PanelConfig & {
  verbPack: ToolVerbPack;
  surface?: OverlaySurfaceMode;
  toolVerbosity?: ToolVerbosity;
};

export function panelRenderConfig(config: TuiConfig): PanelRenderConfig {
  const { panel, borderStyle, overlaySurface, toolVerbosity, verbPack } =
    config;
  return {
    ...panel,
    borderStyle:
      panel.style !== undefined ||
      panel.borderStyle !== DEFAULT_TUI_CONFIG.panel.borderStyle
        ? panel.borderStyle
        : borderStyle,
    verbPack,
    toolVerbosity,
    surface:
      panel.style === undefined && panel.surface === "transparent"
        ? overlaySurface
        : (panel.surface ?? overlaySurface),
  };
}

function formatUnknownToolName(toolName: string): string {
  const cleaned = toolName.replace(/[_-]+/g, " ").trim() || toolName;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Resolve active/settled verb labels for a tool using custom overrides, packs, or fallback. */
export function resolveToolVerb(
  toolName: string,
  config: Pick<PanelRenderConfig, "verbPack" | "customVerbs">,
): CustomToolVerb {
  const custom =
    config.customVerbs && Object.hasOwn(config.customVerbs, toolName)
      ? config.customVerbs[toolName]
      : undefined;
  if (custom) return custom;
  const pack = VERB_PACKS[config.verbPack] ?? VERB_PACKS.standard;
  const known = Object.hasOwn(pack, toolName) ? pack[toolName] : undefined;
  if (known) return known;
  const formatted = formatUnknownToolName(toolName);
  if (config.verbPack === "terse") {
    const lower = formatted.toLowerCase();
    return { active: `${lower}...`, settled: lower };
  }
  return { active: `${formatted}ing...`, settled: `${formatted}ed` };
}
