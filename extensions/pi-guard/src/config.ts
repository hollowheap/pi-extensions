import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type UpdateJsonConfigResult,
  updateJsonConfig,
} from "@hollowheap/core/config";
import { loadGuardTrust } from "@hollowheap/core/trust";

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
  const trust = loadGuardTrust(agentDir, onDiagnostic);
  return {
    trustedRoots: [...trust.trustedRoots],
    decisions: { ...trust.persistentDecisions },
  };
}

export function hasConfiguredTrustedRoots(agentDir: string): boolean {
  try {
    const parsed = JSON.parse(
      readFileSync(getGuardConfigPath(agentDir), "utf8"),
    ) as Record<string, unknown>;
    return Array.isArray(parsed.trustedRoots);
  } catch {
    return false;
  }
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
