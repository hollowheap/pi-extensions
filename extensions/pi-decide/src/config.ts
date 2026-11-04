import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "decide.json";
export const LEGACY_CONFIG_FILE_NAME = "classifier.json";

export interface DecideConfig {
  readonly model?: string;
  readonly timeoutMs: number;
  readonly maxInputChars: number;
  readonly cacheTtlMs: number;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INPUT_CHARS = 20_000;
const MAX_INPUT_CHARS = 100_000;
const DEFAULT_CACHE_TTL_MS = 600_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModel(value: unknown, diagnostics: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim() !== "" && value.includes("/")) {
    return value.trim();
  }
  diagnostics.push(
    '"model" must be "provider/model-id"; using no decide model',
  );
  return undefined;
}

function parseTimeout(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_TIMEOUT_MS
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"timeoutMs" must be between 1 and ${MAX_TIMEOUT_MS}; using ${DEFAULT_TIMEOUT_MS}`,
  );
  return DEFAULT_TIMEOUT_MS;
}

function parseMaxInputChars(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_MAX_INPUT_CHARS;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_INPUT_CHARS
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"maxInputChars" must be between 1 and ${MAX_INPUT_CHARS}; using ${DEFAULT_MAX_INPUT_CHARS}`,
  );
  return DEFAULT_MAX_INPUT_CHARS;
}

function parseCacheTtlMs(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_CACHE_TTL_MS;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 3_600_000
  ) {
    return Math.trunc(value);
  }
  diagnostics.push('"cacheTtlMs" must be between 0 and 3600000; using 600000');
  return DEFAULT_CACHE_TTL_MS;
}

export function loadDecideConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): DecideConfig {
  const decidePath = join(agentDir, CONFIG_FILE_NAME);
  const legacyPath = join(agentDir, LEGACY_CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  let path = decidePath;
  let raw: string | undefined;

  for (const candidate of [decidePath, legacyPath]) {
    path = candidate;
    try {
      raw = readFileSync(candidate, "utf8");
      break;
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") {
        diagnostics.push(
          `${candidate}: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }
  }

  if (raw === undefined) {
    path = decidePath;
    if (onDiagnostic !== undefined) {
      for (const message of diagnostics) onDiagnostic(message);
    }
    return {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxInputChars: DEFAULT_MAX_INPUT_CHARS,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS,
      path,
      diagnostics: Object.freeze(diagnostics),
    };
  }

  if (path === legacyPath) {
    diagnostics.push(
      `${legacyPath} is deprecated; rename it to ${CONFIG_FILE_NAME}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    diagnostics.push(`${path} is not valid JSON; using defaults`);
    parsed = undefined;
  }
  if (parsed !== undefined && !isRecord(parsed)) {
    diagnostics.push(`${path} must be an object; using defaults`);
    parsed = undefined;
  }

  const config: DecideConfig = {
    model: parseModel(isRecord(parsed) ? parsed.model : undefined, diagnostics),
    timeoutMs: parseTimeout(
      isRecord(parsed) ? parsed.timeoutMs : undefined,
      diagnostics,
    ),
    maxInputChars: parseMaxInputChars(
      isRecord(parsed) ? parsed.maxInputChars : undefined,
      diagnostics,
    ),
    cacheTtlMs: parseCacheTtlMs(
      isRecord(parsed) ? parsed.cacheTtlMs : undefined,
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
