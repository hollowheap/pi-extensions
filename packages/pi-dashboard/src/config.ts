import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "dashboard.json";

export type DashboardSection =
  | { type: "header"; ascii: string[]; gap: number }
  | {
      type: "terminal";
      command: string;
      args: string[];
      intervalMs: number;
      gap: number;
    };

export interface DashboardConfig {
  width: number;
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
    width: 60,
    sections: [{ type: "header", ascii: defaultArt(), gap: 0 }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const DEFAULT_INTERVAL_MS = 30000;

function normalizeGap(input: unknown, diagnostics: string[]): number {
  if (input === undefined) return 0;
  if (typeof input === "number" && Number.isInteger(input) && input >= 0) {
    return input;
  }
  diagnostics.push("section gap must be a non-negative integer; using 0");
  return 0;
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
    if (input.ascii === undefined) {
      return {
        type: "header",
        ascii: defaultArt(),
        gap: normalizeGap(input.gap, diagnostics),
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
        gap: normalizeGap(input.gap, diagnostics),
      };
    }
    return {
      type: "header",
      ascii: [...input.ascii],
      gap: normalizeGap(input.gap, diagnostics),
    };
  }
  if (input.type === "terminal") {
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
    return {
      type: "terminal",
      command: input.command,
      args,
      intervalMs,
      gap: normalizeGap(input.gap, diagnostics),
    };
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
