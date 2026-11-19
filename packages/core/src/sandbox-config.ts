import type { SandboxOptions } from "@hollowheap/runtime/sandbox";
import { updateJsonConfig } from "./config.js";
import { isRecord } from "./records.js";

export interface SandboxConfig {
  readonly enabled: boolean;
  readonly offline?: boolean;
  readonly maskPaths?: readonly string[];
}

export type SandboxDiagnosticFormatter = (
  label: string,
  field: string | undefined,
  expected: string,
) => string;

function quotedDiagnostic(
  label: string,
  field: string | undefined,
  expected: string,
): string {
  const path = field === undefined ? label : `${label}.${field}`;
  return `"${path}" must be ${expected}; ignoring`;
}

export function parseSandboxConfig(
  value: unknown,
  diagnostics: string[],
  label = "sandbox",
  formatDiagnostic: SandboxDiagnosticFormatter = quotedDiagnostic,
): boolean | SandboxConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) {
    diagnostics.push(formatDiagnostic(label, undefined, "a boolean or object"));
    return undefined;
  }

  let enabled: boolean | undefined;
  if (value.enabled !== undefined) {
    if (typeof value.enabled === "boolean") {
      enabled = value.enabled;
    } else {
      diagnostics.push(formatDiagnostic(label, "enabled", "a boolean"));
    }
  }

  let offline: boolean | undefined;
  if (value.offline !== undefined) {
    if (typeof value.offline === "boolean") {
      offline = value.offline;
    } else {
      diagnostics.push(formatDiagnostic(label, "offline", "a boolean"));
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
        formatDiagnostic(label, "maskPaths", "an array of non-empty strings"),
      );
    }
  }

  return Object.freeze({
    enabled:
      enabled !== undefined
        ? enabled
        : offline !== undefined || maskPaths !== undefined,
    ...(offline !== undefined ? { offline } : {}),
    ...(maskPaths !== undefined ? { maskPaths } : {}),
  });
}

export function resolveSandboxOptions(
  sandbox: boolean | SandboxConfig | undefined,
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
  sandbox: boolean | SandboxConfig | undefined,
): boolean {
  if (sandbox === true) return true;
  return typeof sandbox === "object" && sandbox.enabled;
}

export function isSandboxOffline(
  sandbox: boolean | SandboxConfig | undefined,
): boolean {
  return typeof sandbox === "object" && sandbox.offline === true;
}

export interface SandboxSettings {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

export function saveSandboxConfig(
  filePath: string,
  settings: SandboxSettings,
): string {
  const res = updateJsonConfig(filePath, (root) => {
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
