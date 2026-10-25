import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ToolExposure = "direct" | "codemode" | "hidden";

export const CONFIG_FILE_NAME = "pi-tools.json";

export interface ToolsConfig {
  readonly fd: ToolExposure;
  readonly rg: ToolExposure;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

const DEFAULT_EXPOSURE: ToolExposure = "direct";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExposure(
  value: unknown,
  name: string,
  diagnostics: string[],
): ToolExposure {
  if (value === undefined) return DEFAULT_EXPOSURE;
  if (value === "direct" || value === "codemode" || value === "hidden") {
    return value;
  }
  diagnostics.push(
    `"${name}" must be "direct", "codemode", or "hidden"; using direct`,
  );
  return DEFAULT_EXPOSURE;
}

export function loadToolsConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): ToolsConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {
      fd: DEFAULT_EXPOSURE,
      rg: DEFAULT_EXPOSURE,
      path,
      diagnostics: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    diagnostics.push(`${path} is not valid JSON; using direct exposure`);
    parsed = undefined;
  }
  if (parsed !== undefined && !isRecord(parsed)) {
    diagnostics.push(`${path} must be an object; using direct exposure`);
    parsed = undefined;
  }

  const config: ToolsConfig = {
    fd: parseExposure(
      isRecord(parsed) ? parsed.fd : undefined,
      "fd",
      diagnostics,
    ),
    rg: parseExposure(
      isRecord(parsed) ? parsed.rg : undefined,
      "rg",
      diagnostics,
    ),
    path,
    diagnostics: Object.freeze(diagnostics),
  };
  if (onDiagnostic !== undefined) {
    for (const message of config.diagnostics) onDiagnostic(message);
  }
  return config;
}
