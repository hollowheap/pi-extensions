import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type UpdateJsonConfigResult,
  formatFsPermissionError,
  isPermissionError,
  updateJsonConfig,
} from "@hollowheap/core/config";

export interface GuardConfig {
  trustedRoots?: string[];
  decisions?: Record<string, "allow" | "ask" | "deny">;
}

export function getGuardConfigPath(agentDir: string): string {
  return join(agentDir, "guard.json");
}

export function loadGuardConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): GuardConfig {
  const path = getGuardConfigPath(agentDir);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { trustedRoots: [], decisions: {} };
    }
    const message = isPermissionError(error)
      ? formatFsPermissionError("read guard config", path, error)
      : `cannot read ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`;
    onDiagnostic?.(message);
    return { trustedRoots: [], decisions: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    onDiagnostic?.(
      `${path} is not valid JSON (${
        error instanceof Error ? error.message : String(error)
      }); using defaults`,
    );
    return { trustedRoots: [], decisions: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    onDiagnostic?.(`${path} must contain a JSON object; using defaults`);
    return { trustedRoots: [], decisions: {} };
  }
  const record = parsed as Record<string, unknown>;
  const trustedRoots = Array.isArray(record.trustedRoots)
    ? record.trustedRoots.filter(
        (root: unknown): root is string =>
          typeof root === "string" && root.trim().length > 0,
      )
    : [];
  const decisions: Record<string, "allow" | "ask" | "deny"> = {};
  if (
    typeof record.decisions === "object" &&
    record.decisions !== null &&
    !Array.isArray(record.decisions)
  ) {
    for (const [key, value] of Object.entries(record.decisions)) {
      if (value === "allow" || value === "ask" || value === "deny") {
        decisions[key] = value;
      }
    }
  }
  return { trustedRoots, decisions };
}

export function saveGuardConfig(
  agentDir: string,
  config: GuardConfig,
): UpdateJsonConfigResult {
  const path = getGuardConfigPath(agentDir);
  return updateJsonConfig(path, (root) => {
    root.trustedRoots = config.trustedRoots ?? [];
    root.decisions = config.decisions ?? {};
  });
}
