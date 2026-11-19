import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatFsPermissionError,
  isPermissionError,
  updateJsonConfig,
} from "@hollowheap/core/config";
import type { SandboxOptions } from "@hollowheap/runtime/sandbox";

export const CONFIG_FILE_NAME = "subagents.json";

export interface SubagentSandboxConfig {
  readonly enabled: boolean;
  readonly offline?: boolean;
  readonly maskPaths?: readonly string[];
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSandboxConfig(
  value: unknown,
  label: string,
  diagnostics: string[],
): boolean | SubagentSandboxConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) {
    diagnostics.push(`"${label}" must be a boolean or object; ignoring`);
    return undefined;
  }

  let enabled: boolean | undefined;
  if (value.enabled !== undefined) {
    if (typeof value.enabled === "boolean") {
      enabled = value.enabled;
    } else {
      diagnostics.push(`"${label}.enabled" must be a boolean; ignoring`);
    }
  }

  let offline: boolean | undefined;
  if (value.offline !== undefined) {
    if (typeof value.offline === "boolean") {
      offline = value.offline;
    } else {
      diagnostics.push(`"${label}.offline" must be a boolean; ignoring`);
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
        `"${label}.maskPaths" must be an array of non-empty strings; ignoring`,
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
      `agents.${name}.sandbox`,
      diagnostics,
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
    agentName !== undefined ? config.agents?.[agentName]?.sandbox : undefined;
  const effective = override !== undefined ? override : config.sandbox;
  if (effective === undefined || effective === false) return undefined;
  if (effective === true) return true;
  if (!effective.enabled) return undefined;
  return {
    ...(effective.offline !== undefined ? { offline: effective.offline } : {}),
    ...(effective.maskPaths !== undefined
      ? { maskPaths: [...effective.maskPaths] }
      : {}),
  };
}

export function isSubagentSandboxEnabled(
  sandbox: boolean | SubagentSandboxConfig | undefined,
): boolean {
  if (sandbox === true) return true;
  return typeof sandbox === "object" && sandbox.enabled;
}

export function isSubagentSandboxOffline(
  sandbox: boolean | SubagentSandboxConfig | undefined,
): boolean {
  return typeof sandbox === "object" && sandbox.offline === true;
}

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
    return {
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      maxDepth: DEFAULT_MAX_DEPTH,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      writeLockTimeoutMs: DEFAULT_WRITE_LOCK_TIMEOUT_MS,
      maxSessionAgents: DEFAULT_MAX_SESSION_AGENTS,
      maxSessionAgentBytes: DEFAULT_MAX_SESSION_AGENT_BYTES,
      harnesses: EMPTY_HARNESSES,
      path,
      diagnostics: Object.freeze(diagnostics),
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

  const sandbox = isRecord(parsed)
    ? parseSandboxConfig(parsed.sandbox, "sandbox", diagnostics)
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
