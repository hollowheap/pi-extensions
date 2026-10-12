import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "dashboard.json";

export type DashboardSource =
  | { kind: "ascii"; lines: string[] }
  | { kind: "command"; command: string; args: string[] };

export interface DashboardConfig {
  width: number;
  intervalMs: number;
  source: DashboardSource;
}

export const DEFAULT_ART: readonly string[] = [
  "╭──────────────────────────────────────╮",
  "│                                      │",
  "│   pi                                 │",
  "│   ready.                             │",
  "│                                      │",
  "╰──────────────────────────────────────╯",
];

function defaultArt(): string[] {
  return [...DEFAULT_ART];
}

export function defaultConfig(): DashboardConfig {
  return {
    width: 60,
    intervalMs: 30000,
    source: { kind: "ascii", lines: defaultArt() },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSource(
  input: unknown,
  diagnostics: string[],
): DashboardSource {
  if (!isRecord(input)) {
    diagnostics.push("source must be an object; using the default banner");
    return { kind: "ascii", lines: defaultArt() };
  }
  if (input.command !== undefined) {
    if (typeof input.command !== "string" || input.command === "") {
      diagnostics.push(
        "source.command must be a non-empty string; using the default banner",
      );
      return { kind: "ascii", lines: defaultArt() };
    }
    if (
      input.args !== undefined &&
      (!Array.isArray(input.args) ||
        !input.args.every((arg) => typeof arg === "string"))
    ) {
      diagnostics.push(
        "source.args must be an array of strings; using the default banner",
      );
      return { kind: "ascii", lines: defaultArt() };
    }
    if (input.ascii !== undefined) {
      diagnostics.push("source has both ascii and command; using command");
    }
    return {
      kind: "command",
      command: input.command,
      args: Array.isArray(input.args) ? [...input.args] : [],
    };
  }
  if (input.ascii === undefined) return { kind: "ascii", lines: defaultArt() };
  if (
    !Array.isArray(input.ascii) ||
    !input.ascii.every((line) => typeof line === "string")
  ) {
    diagnostics.push(
      "source.ascii must be an array of strings; using the default banner",
    );
    return { kind: "ascii", lines: defaultArt() };
  }
  return { kind: "ascii", lines: [...input.ascii] };
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
  if (input.intervalMs !== undefined) {
    if (
      typeof input.intervalMs === "number" &&
      Number.isFinite(input.intervalMs) &&
      input.intervalMs > 0
    ) {
      config.intervalMs = input.intervalMs;
    } else {
      diagnostics.push("intervalMs must be a positive number; using default");
    }
  }
  if (input.source !== undefined) {
    config.source = normalizeSource(input.source, diagnostics);
  }
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
  } catch {
    return { config: defaultConfig(), diagnostics: [], path };
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
