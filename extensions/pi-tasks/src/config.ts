import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatFsPermissionError,
  isPermissionError,
  updateJsonConfig,
} from "@hollowheap/core/config";
import type { SandboxOptions } from "@hollowheap/runtime/sandbox";

export const CONFIG_FILE_NAME = "tasks.json";

export interface TasksSandboxConfig {
  readonly enabled: boolean;
  readonly offline?: boolean;
  readonly maskPaths?: readonly string[];
}

export interface TasksConfig {
  readonly sandbox?: boolean | TasksSandboxConfig;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

export interface TasksSettings {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSandboxConfig(
  value: unknown,
  diagnostics: string[],
): boolean | TasksSandboxConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) {
    diagnostics.push('"sandbox" must be a boolean or object; ignoring');
    return undefined;
  }

  let enabled: boolean | undefined;
  if (value.enabled !== undefined) {
    if (typeof value.enabled === "boolean") {
      enabled = value.enabled;
    } else {
      diagnostics.push('"sandbox.enabled" must be a boolean; ignoring');
    }
  }

  let offline: boolean | undefined;
  if (value.offline !== undefined) {
    if (typeof value.offline === "boolean") {
      offline = value.offline;
    } else {
      diagnostics.push('"sandbox.offline" must be a boolean; ignoring');
    }
  }

  let maskPaths: readonly string[] | undefined;
  if (value.maskPaths !== undefined) {
    if (
      Array.isArray(value.maskPaths) &&
      value.maskPaths.every(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim() !== "",
      )
    ) {
      maskPaths = Object.freeze([...value.maskPaths]);
    } else {
      diagnostics.push(
        '"sandbox.maskPaths" must be an array of non-empty strings; ignoring',
      );
    }
  }

  const resolvedEnabled =
    enabled !== undefined
      ? enabled
      : offline !== undefined || maskPaths !== undefined;

  return Object.freeze({
    enabled: resolvedEnabled,
    ...(offline !== undefined ? { offline } : {}),
    ...(maskPaths !== undefined ? { maskPaths } : {}),
  });
}

export function resolveTasksSandboxOptions(
  sandbox: boolean | TasksSandboxConfig | undefined,
): boolean | SandboxOptions | undefined {
  if (sandbox === undefined || sandbox === false) return undefined;
  if (sandbox === true) return true;
  if (!sandbox.enabled) return undefined;
  return {
    ...(sandbox.offline !== undefined ? { offline: sandbox.offline } : {}),
    ...(sandbox.maskPaths !== undefined
      ? { maskPaths: [...sandbox.maskPaths] }
      : {}),
  };
}

export function isSandboxEnabled(
  sandbox: boolean | TasksSandboxConfig | undefined,
): boolean {
  if (sandbox === true) return true;
  return typeof sandbox === "object" && sandbox.enabled;
}

export function isSandboxOffline(
  sandbox: boolean | TasksSandboxConfig | undefined,
): boolean {
  return typeof sandbox === "object" && sandbox.offline === true;
}

export function loadTasksConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): TasksConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") {
      diagnostics.push(
        isPermissionError(error)
          ? formatFsPermissionError("read config file", path, error)
          : `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (onDiagnostic !== undefined) {
        for (const message of diagnostics) onDiagnostic(message);
      }
    }
    return { path, diagnostics: Object.freeze(diagnostics) };
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

  const sandbox = isRecord(parsed)
    ? parseSandboxConfig(parsed.sandbox, diagnostics)
    : undefined;

  const config: TasksConfig = {
    ...(sandbox !== undefined ? { sandbox } : {}),
    path,
    diagnostics: Object.freeze(diagnostics),
  };
  if (onDiagnostic !== undefined) {
    for (const message of config.diagnostics) onDiagnostic(message);
  }
  return config;
}

/** Persist sandbox settings in tasks.json while preserving unrelated keys. */
export function saveTasksSettings(
  agentDir: string,
  settings: TasksSettings,
): string {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const res = updateJsonConfig(path, (root) => {
    const existing = isRecord(root.sandbox) ? { ...root.sandbox } : {};
    const next: Record<string, unknown> = {
      ...existing,
      enabled: settings.sandboxEnabled,
    };
    if (settings.sandboxOffline !== undefined) {
      next.offline = settings.sandboxOffline;
    }
    if (settings.maskPaths !== undefined) {
      next.maskPaths = [...settings.maskPaths];
    }
    root.sandbox = next;
  });
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.path;
}
