import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@hollowheap/core/records";
import {
  type SandboxConfig,
  isSandboxEnabled,
  isSandboxOffline,
  parseSandboxConfig,
  resolveSandboxOptions,
  saveSandboxConfig,
} from "@hollowheap/core/sandbox-config";
import { showSandboxSettings } from "@hollowheap/pi-ui/sandbox-settings";

import { readJsonObject } from "@hollowheap/core/config";
import {
  type BwrapProbeResult,
  type SandboxOptions,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";

export const CONFIG_FILE_NAME = "subagents.json";

export type SubagentSandboxConfig = SandboxConfig;

export interface SubagentAgentOverride {
  readonly sandbox?: boolean | SubagentSandboxConfig;
}

export type SubagentHarnessTransport = "headless" | "acp";

export interface SubagentHarnessConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly input: "stdin" | "arg";
  readonly transport?: SubagentHarnessTransport;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SubagentsConfig {
  readonly maxConcurrent: number;
  readonly maxDepth: number;
  readonly defaultTimeoutMs: number;
  readonly writeLockTimeoutMs: number;
  readonly maxSessionAgents: number;
  readonly maxSessionAgentBytes: number;
  readonly harnesses: Readonly<Record<string, SubagentHarnessConfig>>;
  readonly sandbox?: boolean | SubagentSandboxConfig;
  readonly agents?: Readonly<Record<string, SubagentAgentOverride>>;
  readonly path: string;
  readonly diagnostics: readonly string[];
}

export interface SubagentsSettings {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

const EMPTY_HARNESSES: Readonly<Record<string, SubagentHarnessConfig>> =
  Object.freeze({});

const DEFAULT_MAX_CONCURRENT = 4;
const MAX_MAX_CONCURRENT = 8;
const DEFAULT_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WRITE_LOCK_TIMEOUT_MS = 30 * 1000;
const MAX_WRITE_LOCK_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_SESSION_AGENTS = 32;
const MAX_MAX_SESSION_AGENTS = 128;
const DEFAULT_MAX_SESSION_AGENT_BYTES = 64 * 1024;
const MIN_MAX_SESSION_AGENT_BYTES = 1024;
const MAX_MAX_SESSION_AGENT_BYTES = 1024 * 1024;

function parseAgents(
  value: unknown,
  diagnostics: string[],
): Readonly<Record<string, SubagentAgentOverride>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    diagnostics.push('"agents" must be an object; ignoring');
    return undefined;
  }
  const agents: Record<string, SubagentAgentOverride> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      diagnostics.push(`invalid agent config name "${name}"; ignoring`);
      continue;
    }
    if (!isRecord(raw)) {
      diagnostics.push(`agent "${name}" config must be an object; ignoring`);
      continue;
    }
    const sandbox = parseSandboxConfig(
      raw.sandbox,
      diagnostics,
      `agents.${name}.sandbox`,
    );
    if (sandbox !== undefined) {
      agents[name] = Object.freeze({ sandbox });
    }
  }
  return Object.keys(agents).length > 0 ? Object.freeze(agents) : undefined;
}

export function resolveSubagentSandboxOptions(
  config: Pick<SubagentsConfig, "sandbox" | "agents">,
  agentName?: string,
): boolean | SandboxOptions | undefined {
  const override =
    agentName !== undefined &&
    config.agents !== undefined &&
    Object.hasOwn(config.agents, agentName)
      ? config.agents[agentName]?.sandbox
      : undefined;
  const effective = override !== undefined ? override : config.sandbox;
  return resolveSandboxOptions(effective);
}

export const isSubagentSandboxEnabled = isSandboxEnabled;
export const isSubagentSandboxOffline = isSandboxOffline;

function parseHarnesses(
  value: unknown,
  diagnostics: string[],
): Readonly<Record<string, SubagentHarnessConfig>> {
  if (value === undefined) return EMPTY_HARNESSES;
  if (!isRecord(value)) {
    diagnostics.push('"harnesses" must be an object; ignoring');
    return EMPTY_HARNESSES;
  }
  const harnesses: Record<string, SubagentHarnessConfig> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      diagnostics.push(`invalid harness name "${name}"; ignoring`);
      continue;
    }
    if (!isRecord(raw)) {
      diagnostics.push(`harness "${name}" must be an object; ignoring`);
      continue;
    }
    const command = typeof raw.command === "string" ? raw.command.trim() : "";
    if (command === "") {
      diagnostics.push(`harness "${name}" needs a command; ignoring`);
      continue;
    }
    let args: string[] = [];
    if (raw.args !== undefined) {
      if (
        !Array.isArray(raw.args) ||
        !raw.args.every((arg): arg is string => typeof arg === "string")
      ) {
        diagnostics.push(`harness "${name}" args must be strings; ignoring`);
        continue;
      }
      args = [...raw.args];
    }
    let input: "stdin" | "arg" = "stdin";
    if (raw.input !== undefined) {
      if (raw.input !== "stdin" && raw.input !== "arg") {
        diagnostics.push(
          `harness "${name}" input must be "stdin" or "arg"; ignoring`,
        );
        continue;
      }
      input = raw.input;
    }
    let env: Record<string, string> | undefined;
    if (raw.env !== undefined) {
      if (
        !isRecord(raw.env) ||
        !Object.values(raw.env).every(
          (entry): entry is string => typeof entry === "string",
        )
      ) {
        diagnostics.push(
          `harness "${name}" env must contain string values; ignoring`,
        );
        continue;
      }
      env = { ...raw.env } as Record<string, string>;
    }
    const transport = raw.transport;
    if (
      transport !== undefined &&
      transport !== "headless" &&
      transport !== "acp"
    ) {
      diagnostics.push(
        `harness "${name}" transport must be "headless" or "acp"; ignoring`,
      );
      continue;
    }
    harnesses[name] = Object.freeze({
      command,
      args: Object.freeze(args),
      input,
      ...(transport !== undefined ? { transport } : {}),
      ...(env ? { env: Object.freeze(env) } : {}),
    });
  }
  return Object.freeze(harnesses);
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

export function resolveSubagentWaitTimeoutMs(
  config: Pick<SubagentsConfig, "defaultTimeoutMs">,
  overrideMs?: number,
): number {
  if (overrideMs !== undefined) return overrideMs;
  // `waitSubagent` treats an instruction to wait 0 ms as a single poll, so the
  // documented "0 disables" value is represented as no deadline instead.
  return config.defaultTimeoutMs === 0
    ? Number.POSITIVE_INFINITY
    : config.defaultTimeoutMs;
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

function parseMaxSessionAgents(value: unknown, diagnostics: string[]): number {
  if (value === undefined) return DEFAULT_MAX_SESSION_AGENTS;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_MAX_SESSION_AGENTS
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"maxSessionAgents" must be between 1 and ${MAX_MAX_SESSION_AGENTS}; using ${DEFAULT_MAX_SESSION_AGENTS}`,
  );
  return DEFAULT_MAX_SESSION_AGENTS;
}

function parseMaxSessionAgentBytes(
  value: unknown,
  diagnostics: string[],
): number {
  if (value === undefined) return DEFAULT_MAX_SESSION_AGENT_BYTES;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_MAX_SESSION_AGENT_BYTES &&
    value <= MAX_MAX_SESSION_AGENT_BYTES
  ) {
    return Math.trunc(value);
  }
  diagnostics.push(
    `"maxSessionAgentBytes" must be between ${MIN_MAX_SESSION_AGENT_BYTES} and ${MAX_MAX_SESSION_AGENT_BYTES}; using ${DEFAULT_MAX_SESSION_AGENT_BYTES}`,
  );
  return DEFAULT_MAX_SESSION_AGENT_BYTES;
}

export function loadSubagentsConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): SubagentsConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  const parsed = readJsonObject(path, diagnostics);

  const sandbox = isRecord(parsed)
    ? parseSandboxConfig(parsed.sandbox, diagnostics)
    : undefined;
  const agents = isRecord(parsed)
    ? parseAgents(parsed.agents, diagnostics)
    : undefined;

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
    maxSessionAgents: parseMaxSessionAgents(
      isRecord(parsed) ? parsed.maxSessionAgents : undefined,
      diagnostics,
    ),
    maxSessionAgentBytes: parseMaxSessionAgentBytes(
      isRecord(parsed) ? parsed.maxSessionAgentBytes : undefined,
      diagnostics,
    ),
    harnesses: parseHarnesses(
      isRecord(parsed) ? parsed.harnesses : undefined,
      diagnostics,
    ),
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(agents !== undefined ? { agents } : {}),
    path,
    diagnostics: Object.freeze(diagnostics),
  };
  if (onDiagnostic !== undefined) {
    for (const message of config.diagnostics) onDiagnostic(message);
  }
  return config;
}

/** Persist top-level sandbox settings in subagents.json while preserving unrelated config. */
export function saveSubagentsSettings(
  agentDir: string,
  settings: SubagentsSettings,
): string {
  return saveSandboxConfig(join(agentDir, CONFIG_FILE_NAME), settings);
}

export { formatBwrapProbeStatus } from "@hollowheap/pi-ui/sandbox-settings";

export async function showSubagentsSettings(
  ctx: ExtensionContext,
  config: SubagentsConfig,
  onSave: (settings: SubagentsSettings) => void,
  probeBwrap: () => BwrapProbeResult = () => probeBwrapAvailability(),
): Promise<void> {
  await showSandboxSettings({
    ctx,
    title: "Subagent settings",
    label: "Sandbox subagents (bwrap)",
    enabledDescription: (statusText) =>
      `Isolate child subagent processes in Bubblewrap (${statusText})`,
    offlineDescription:
      "Disable network access inside the subagent sandbox (--unshare-net)",
    enabled: isSubagentSandboxEnabled(config.sandbox),
    offline: isSubagentSandboxOffline(config.sandbox),
    probeBwrap,
    onSave,
  });
}
