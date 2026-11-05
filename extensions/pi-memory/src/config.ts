import { readFileSync } from "node:fs";
import { join } from "node:path";

export const MEMORY_CONFIG_FILE = "memory.json";

export interface MemoryConfig {
  readonly enabled: boolean;
  readonly model: string;
  readonly observeAfterTokens: number;
  readonly maxObservations: number;
  readonly injectionTokens: number;
  readonly redactSecrets: boolean;
  readonly notifyErrors: boolean;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

const DEFAULT_OBSERVE_AFTER_TOKENS = 20_000;
const MAX_OBSERVE_AFTER_TOKENS = 200_000;
const DEFAULT_MAX_OBSERVATIONS = 50;
const MAX_MAX_OBSERVATIONS = 200;
const DEFAULT_INJECTION_TOKENS = 2_000;
const MIN_INJECTION_TOKENS = 100;
const MAX_INJECTION_TOKENS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoolean(
  value: unknown,
  fallback: boolean,
  name: string,
  diagnostics: string[],
): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  diagnostics.push(`"${name}" must be a boolean; using ${fallback}`);
  return fallback;
}

function parseInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
  diagnostics: string[],
): number {
  if (value === undefined) return fallback;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"${name}" must be between ${minimum} and ${maximum}; using ${fallback}`,
  );
  return fallback;
}

function parseModel(value: unknown, diagnostics: string[]): string {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    diagnostics.push('"model" must be a string; using no model');
    return "";
  }
  const model = value.trim();
  if (model !== "") {
    const [provider, ...rest] = model.split("/");
    if (provider === "" || rest.join("/") === "") {
      diagnostics.push('"model" must be "provider/model-id"; using no model');
      return "";
    }
  }
  return model;
}

export function isMemoryActive(config: MemoryConfig): boolean {
  return config.enabled && config.model !== "";
}

export function loadMemoryConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): MemoryConfig {
  const path = join(agentDir, MEMORY_CONFIG_FILE);
  const diagnostics: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") {
      diagnostics.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (parsed !== undefined && !isRecord(parsed)) {
    diagnostics.push(`${path} must be an object; using defaults`);
    parsed = undefined;
  }

  const enabled = parseBoolean(
    isRecord(parsed) ? parsed.enabled : undefined,
    false,
    "enabled",
    diagnostics,
  );
  const model = parseModel(
    isRecord(parsed) ? parsed.model : undefined,
    diagnostics,
  );
  if (enabled && model === "") {
    diagnostics.push(
      '"model" is required when "enabled" is true; observer is inactive',
    );
  }

  const config: MemoryConfig = {
    enabled,
    model,
    observeAfterTokens: parseInteger(
      isRecord(parsed) ? parsed.observeAfterTokens : undefined,
      DEFAULT_OBSERVE_AFTER_TOKENS,
      1_000,
      MAX_OBSERVE_AFTER_TOKENS,
      "observeAfterTokens",
      diagnostics,
    ),
    maxObservations: parseInteger(
      isRecord(parsed) ? parsed.maxObservations : undefined,
      DEFAULT_MAX_OBSERVATIONS,
      1,
      MAX_MAX_OBSERVATIONS,
      "maxObservations",
      diagnostics,
    ),
    injectionTokens: parseInteger(
      isRecord(parsed) ? parsed.injectionTokens : undefined,
      DEFAULT_INJECTION_TOKENS,
      MIN_INJECTION_TOKENS,
      MAX_INJECTION_TOKENS,
      "injectionTokens",
      diagnostics,
    ),
    redactSecrets: parseBoolean(
      isRecord(parsed) ? parsed.redactSecrets : undefined,
      true,
      "redactSecrets",
      diagnostics,
    ),
    notifyErrors: parseBoolean(
      isRecord(parsed) ? parsed.notifyErrors : undefined,
      false,
      "notifyErrors",
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
