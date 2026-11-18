import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatFsPermissionError,
  isPermissionError,
  updateJsonConfig,
} from "@hollowheap/core/config";

export const CONFIG_FILE_NAME = "dashboard.json";
export const DEFAULT_INTERVAL_MS = 30000;
export const DEFAULT_MAX_SESSIONS = 5;

export type DashboardSection =
  | {
      type: "header";
      ascii: string[];
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "state";
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "sessions";
      maxItems: number;
      scope: "cwd" | "all";
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "actions";
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "terminal";
      command: string;
      args: string[];
      intervalMs: number;
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "context";
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "skills";
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    }
  | {
      type: "extensions";
      align?: "left" | "center";
      gap: number;
      enabled?: boolean;
    };

export interface DashboardConfig {
  width: number;
  autoHide?: boolean;
  sections: DashboardSection[];
}

// Pi logo rendered on a 4x4 solid-block grid (two columns per cell).
export const DEFAULT_ART: readonly string[] = [
  "",
  "██████  ",
  "██  ██  ",
  "████  ██",
  "██    ██",
  "",
];

function defaultArt(): string[] {
  return [...DEFAULT_ART];
}

export function defaultConfig(): DashboardConfig {
  return {
    width: 72,
    autoHide: true,
    sections: [
      { type: "header", ascii: defaultArt(), gap: 1 },
      { type: "state", gap: 1 },
      {
        type: "sessions",
        maxItems: DEFAULT_MAX_SESSIONS,
        scope: "cwd",
        gap: 1,
      },
      { type: "actions", gap: 0 },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderedSectionList(
  value: unknown,
): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every(
      (section) => isRecord(section) && typeof section.enabled === "boolean",
    )
  );
}

function normalizeGap(input: unknown, diagnostics: string[]): number {
  if (input === undefined) return 0;
  if (typeof input === "number" && Number.isInteger(input) && input >= 0) {
    return input;
  }
  diagnostics.push("section gap must be a non-negative integer; using 0");
  return 0;
}

function normalizeAlign(
  input: unknown,
  label: string,
  diagnostics: string[],
): "left" | "center" | undefined {
  if (input === undefined) return undefined;
  if (input === "left" || input === "center") return input;
  diagnostics.push(`${label} align must be "left" or "center"; using left`);
  return undefined;
}

function normalizeHeaderSection(
  input: Record<string, unknown>,
  diagnostics: string[],
): DashboardSection {
  const align = normalizeAlign(input.align, "header", diagnostics);
  const gap = normalizeGap(input.gap, diagnostics);
  if (input.ascii === undefined) {
    return {
      type: "header",
      ascii: defaultArt(),
      ...(align ? { align } : {}),
      gap,
    };
  }
  if (
    !Array.isArray(input.ascii) ||
    !input.ascii.every((line) => typeof line === "string")
  ) {
    diagnostics.push(
      "header ascii must be an array of strings; using the default banner",
    );
    return {
      type: "header",
      ascii: defaultArt(),
      ...(align ? { align } : {}),
      gap,
    };
  }
  return {
    type: "header",
    ascii: [...input.ascii],
    ...(align ? { align } : {}),
    gap,
  };
}

function normalizeSessionsSection(
  input: Record<string, unknown>,
  diagnostics: string[],
): DashboardSection {
  let maxItems = DEFAULT_MAX_SESSIONS;
  if (input.maxItems !== undefined) {
    if (
      typeof input.maxItems === "number" &&
      Number.isInteger(input.maxItems) &&
      input.maxItems >= 1 &&
      input.maxItems <= 20
    ) {
      maxItems = input.maxItems;
    } else {
      diagnostics.push(
        "sessions maxItems must be an integer between 1 and 20; using default",
      );
    }
  }
  let scope: "cwd" | "all" = "cwd";
  if (input.scope !== undefined) {
    if (input.scope === "cwd" || input.scope === "all") {
      scope = input.scope;
    } else {
      diagnostics.push('sessions scope must be "cwd" or "all"; using cwd');
    }
  }
  const align = normalizeAlign(input.align, "sessions", diagnostics);
  return {
    type: "sessions",
    maxItems,
    scope,
    ...(align ? { align } : {}),
    gap: normalizeGap(input.gap, diagnostics),
  };
}

function normalizeTerminalSection(
  input: Record<string, unknown>,
  diagnostics: string[],
): DashboardSection | undefined {
  if (typeof input.command !== "string" || input.command === "") {
    diagnostics.push("terminal command must be a non-empty string; skipping");
    return undefined;
  }
  let args: string[] = [];
  if (input.args !== undefined) {
    if (
      Array.isArray(input.args) &&
      input.args.every((arg) => typeof arg === "string")
    ) {
      args = [...input.args];
    } else {
      diagnostics.push("terminal args must be an array of strings; using []");
    }
  }
  let intervalMs = DEFAULT_INTERVAL_MS;
  if (input.intervalMs !== undefined) {
    if (
      typeof input.intervalMs === "number" &&
      Number.isFinite(input.intervalMs) &&
      input.intervalMs > 0
    ) {
      intervalMs = input.intervalMs;
    } else {
      diagnostics.push("terminal intervalMs must be positive; using default");
    }
  }
  const align = normalizeAlign(input.align, "terminal", diagnostics);
  return {
    type: "terminal",
    command: input.command,
    args,
    intervalMs,
    ...(align ? { align } : {}),
    gap: normalizeGap(input.gap, diagnostics),
  };
}

function normalizeSection(
  input: unknown,
  diagnostics: string[],
): DashboardSection | undefined {
  if (!isRecord(input)) {
    diagnostics.push("ignoring section: must be an object");
    return undefined;
  }
  if (input.type === "header" || input.type === undefined) {
    return normalizeHeaderSection(input, diagnostics);
  }
  // Deprecated fastfetch-style version preset removed silently for existing configs.
  if (input.type === "version") {
    return undefined;
  }
  if (input.type === "state") {
    const align = normalizeAlign(input.align, "state", diagnostics);
    return {
      type: "state",
      ...(align ? { align } : {}),
      gap: normalizeGap(input.gap, diagnostics),
    };
  }
  if (input.type === "sessions") {
    return normalizeSessionsSection(input, diagnostics);
  }
  if (input.type === "actions") {
    const align = normalizeAlign(input.align, "actions", diagnostics);
    return {
      type: "actions",
      ...(align ? { align } : {}),
      gap: normalizeGap(input.gap, diagnostics),
    };
  }
  if (input.type === "terminal") {
    return normalizeTerminalSection(input, diagnostics);
  }
  diagnostics.push(`ignoring unknown section type "${String(input.type)}"`);
  return undefined;
}

export function normalizeConfig(input: unknown): {
  config: DashboardConfig;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const config = defaultConfig();
  if (!isRecord(input)) {
    if (input !== undefined) {
      diagnostics.push("config root must be an object; using defaults");
    }
    return { config, diagnostics };
  }
  if (input.width !== undefined) {
    if (
      typeof input.width === "number" &&
      Number.isInteger(input.width) &&
      input.width >= 10 &&
      input.width <= 500
    ) {
      config.width = input.width;
    } else {
      diagnostics.push(
        "width must be an integer between 10 and 500; using default",
      );
    }
  }
  if (input.autoHide !== undefined) {
    if (typeof input.autoHide === "boolean") {
      config.autoHide = input.autoHide;
    } else {
      diagnostics.push("autoHide must be a boolean; using true");
    }
  }
  if (input.intervalMs !== undefined) {
    diagnostics.push(
      "top-level intervalMs moved into terminal sections; ignoring",
    );
  }
  if (input.source !== undefined) {
    diagnostics.push("source was replaced by sections; ignoring");
  }
  if (input.sections === undefined) return { config, diagnostics };
  if (!Array.isArray(input.sections)) {
    diagnostics.push("sections must be an array; using defaults");
    return { config, diagnostics };
  }
  if (isOrderedSectionList(input.sections)) {
    config.sections = input.sections as unknown as DashboardSection[];
    return { config, diagnostics };
  }
  const sections: DashboardSection[] = [];
  for (const entry of input.sections) {
    const section = normalizeSection(entry, diagnostics);
    if (section !== undefined) sections.push(section);
  }
  config.sections = sections;
  return { config, diagnostics };
}

export function loadConfig(agentDir: string): {
  config: DashboardConfig;
  diagnostics: string[];
  path: string;
} {
  const path = join(agentDir, CONFIG_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const diagnostics =
      (error as { code?: unknown }).code === "ENOENT"
        ? []
        : [
            isPermissionError(error)
              ? formatFsPermissionError("read config file", path, error)
              : `${path}: ${error instanceof Error ? error.message : String(error)}`,
          ];
    return { config: defaultConfig(), diagnostics, path };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      config: defaultConfig(),
      diagnostics: [`${path} is not valid JSON; using defaults`],
      path,
    };
  }
  const { config, diagnostics } = normalizeConfig(parsed);
  return { config, diagnostics, path };
}

export type DashboardHeaderPreset = "banner" | "none";

export interface DashboardSettings {
  header: DashboardHeaderPreset;
  gap: number;
  showState?: boolean;
  showSessions?: boolean;
  showActions?: boolean;
  autoHide?: boolean;
  sections?: DashboardSection[];
}

/** Persist dashboard header/section settings while preserving terminal sections. */
export function saveDashboardSettings(
  agentDir: string,
  settings: DashboardSettings,
): string {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const res = updateJsonConfig(path, (root) => {
    if (isOrderedSectionList(settings.sections)) {
      root.sections = settings.sections;
      return;
    }
    const sections = Array.isArray(root.sections) ? root.sections : [];
    const existingHeader = sections.find(
      (section) =>
        isRecord(section) &&
        (section.type === "header" || section.type === undefined),
    );
    const existingState = sections.find(
      (section) => isRecord(section) && section.type === "state",
    );
    const existingSessions = sections.find(
      (section) => isRecord(section) && section.type === "sessions",
    );
    const existingActions = sections.find(
      (section) => isRecord(section) && section.type === "actions",
    );
    const terminals = sections.filter(
      (section) => isRecord(section) && section.type === "terminal",
    );

    const nextSections: Record<string, unknown>[] = [];
    if (settings.header !== "none") {
      const baseHeader = isRecord(existingHeader) ? { ...existingHeader } : {};
      nextSections.push({
        ...baseHeader,
        type: "header",
        gap: settings.gap,
      });
    }
    nextSections.push(...(terminals as Record<string, unknown>[]));

    const includeState =
      settings.showState !== undefined
        ? settings.showState
        : existingState !== undefined;
    if (includeState) {
      nextSections.push(
        isRecord(existingState)
          ? { ...existingState }
          : { type: "state", gap: 1 },
      );
    }

    const includeSessions =
      settings.showSessions !== undefined
        ? settings.showSessions
        : existingSessions !== undefined;
    if (includeSessions) {
      nextSections.push(
        isRecord(existingSessions)
          ? { ...existingSessions }
          : {
              type: "sessions",
              maxItems: DEFAULT_MAX_SESSIONS,
              scope: "cwd",
              gap: 1,
            },
      );
    }

    const includeActions =
      settings.showActions !== undefined
        ? settings.showActions
        : existingActions !== undefined;
    if (includeActions) {
      nextSections.push(
        isRecord(existingActions)
          ? { ...existingActions }
          : { type: "actions", gap: 0 },
      );
    }

    if (settings.autoHide !== undefined) {
      root.autoHide = settings.autoHide;
    }
    root.sections = nextSections;
  });
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.path;
}
