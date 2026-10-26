import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "subagents.json";

export interface SubagentsConfig {
  readonly maxConcurrent: number;
  readonly maxDepth: number;
  readonly defaultTimeoutMs: number;
  readonly writeLockTimeoutMs: number;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

const DEFAULT_MAX_CONCURRENT = 4;
const MAX_MAX_CONCURRENT = 8;
const DEFAULT_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WRITE_LOCK_TIMEOUT_MS = 30 * 1000;
const MAX_WRITE_LOCK_TIMEOUT_MS = 300_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaxConcurrent(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_MAX_CONCURRENT;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_MAX_CONCURRENT
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"maxConcurrent" must be between 1 and ${MAX_MAX_CONCURRENT}; using ${DEFAULT_MAX_CONCURRENT}`,
  );
  return DEFAULT_MAX_CONCURRENT;
}

function parseMaxDepth(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_MAX_DEPTH;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_MAX_DEPTH
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"maxDepth" must be between 1 and ${MAX_MAX_DEPTH}; using ${DEFAULT_MAX_DEPTH}`,
  );
  return DEFAULT_MAX_DEPTH;
}

function parseDefaultTimeoutMs(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TIMEOUT_MS
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"defaultTimeoutMs" must be between 0 and ${MAX_TIMEOUT_MS}; using ${DEFAULT_TIMEOUT_MS}`,
  );
  return DEFAULT_TIMEOUT_MS;
}

function parseWriteLockTimeoutMs(
  value: unknown,
  diagnostics: string[],
): number {
  if (value === undefined) return DEFAULT_WRITE_LOCK_TIMEOUT_MS;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_WRITE_LOCK_TIMEOUT_MS
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"writeLockTimeoutMs" must be between 1 and ${MAX_WRITE_LOCK_TIMEOUT_MS}; using ${DEFAULT_WRITE_LOCK_TIMEOUT_MS}`,
  );
  return DEFAULT_WRITE_LOCK_TIMEOUT_MS;
}

export function loadSubagentsConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): SubagentsConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      maxDepth: DEFAULT_MAX_DEPTH,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      writeLockTimeoutMs: DEFAULT_WRITE_LOCK_TIMEOUT_MS,
      path,
      diagnostics: [],
    };
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

  const config: SubagentsConfig = {
    maxConcurrent: parseMaxConcurrent(
      isRecord(parsed) ? parsed.maxConcurrent : undefined,
      diagnostics,
    ),
    maxDepth: parseMaxDepth(
      isRecord(parsed) ? parsed.maxDepth : undefined,
      diagnostics,
    ),
    defaultTimeoutMs: parseDefaultTimeoutMs(
      isRecord(parsed) ? parsed.defaultTimeoutMs : undefined,
      diagnostics,
    ),
    writeLockTimeoutMs: parseWriteLockTimeoutMs(
      isRecord(parsed) ? parsed.writeLockTimeoutMs : undefined,
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
