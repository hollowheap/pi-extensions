import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  type UpdateJsonConfigResult,
  readJsonObject,
} from "@hollowheap/core/config";
import { getModeLayer } from "@hollowheap/core/modes";
import {
  type SandboxOptions,
  parseSandboxConfig,
  resolveSandboxOptions,
} from "@hollowheap/core/sandbox-config";
import {
  type GuardTrustConfig,
  type TrustedRoot,
  loadGuardTrust,
  saveGuardTrust,
} from "@hollowheap/core/trust";

export type Config = GuardTrustConfig;

export function rootPath(root: TrustedRoot): string {
  return typeof root === "string" ? root : root.path;
}

export function configPath(agentDir: string): string {
  return join(agentDir, "guard.json");
}

export function loadConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): Config {
  const trust = loadGuardTrust(agentDir, onDiagnostic);
  return {
    trustedRoots: [...trust.trustedRoots],
    decisions: { ...trust.persistentDecisions },
  };
}

export function loadGuardSandboxOptions(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): boolean | SandboxOptions | undefined {
  const raw = readJsonObject(configPath(agentDir), []);
  if (!raw || raw.sandbox === undefined) return undefined;
  const diagnostics: string[] = [];
  const parsed = parseSandboxConfig(raw.sandbox, diagnostics);
  if (onDiagnostic) {
    for (const msg of diagnostics) onDiagnostic(msg);
  }
  return resolveSandboxOptions(parsed);
}

export function hasTrustedRoots(agentDir: string): boolean {
  return Array.isArray(readJsonObject(configPath(agentDir), [])?.trustedRoots);
}

export function saveConfig(
  agentDir: string,
  config: Config,
): UpdateJsonConfigResult {
  return saveGuardTrust(agentDir, config);
}

export interface StatusInfo {
  mode: string;
  agentDir: string;
  trustedRootsCount: number;
  savedDecisionsCount: number;
  activeGrantsCount: number;
}

export function formatStatus(info: StatusInfo): string {
  return [
    `mode=${info.mode}`,
    `trustedRoots=${info.trustedRootsCount}`,
    `savedRules=${info.savedDecisionsCount}`,
    `activeGrants=${info.activeGrantsCount}`,
    `config=${configPath(info.agentDir)}`,
  ].join(" · ");
}

export function modesPath(): string {
  return join(getAgentDir(), "modes.json");
}

export function readDefaultMode(): string | undefined {
  const value = readJsonObject(modesPath(), [])?.default;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function isKnownMode(name: string): boolean {
  if (getModeLayer(name) !== undefined) return true;
  const modes = readJsonObject(modesPath(), [])?.modes;
  if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
    return false;
  }
  return Object.hasOwn(modes, name);
}
