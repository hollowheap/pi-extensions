import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@hollowheap/core/records";
import {
  type SandboxConfig as HookSandboxConfig,
  isSandboxEnabled as isHookSandboxEnabled,
  isSandboxOffline as isHookSandboxOffline,
  parseSandboxConfig,
  resolveSandboxOptions as resolveHookSandboxOptions,
  saveSandboxConfig,
} from "@hollowheap/core/sandbox-config";
import { showSandboxSettings } from "@hollowheap/pi-ui/sandbox-settings";

import {
  formatFsPermissionError,
  isPermissionError,
} from "@hollowheap/core/config";
import { getMtimeCache } from "@hollowheap/core/mtime-cache";
import {
  type BwrapProbeResult,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";

export type { HookSandboxConfig };
export interface HookEntry {
  /** Exact tool name, a trailing "*" prefix, or "" for every tool. Ignored for sessionStart. */
  matcher: string;
  command: string;
  args: string[];
  timeoutMs: number;
  /** Optional condition: skip hook if condition evaluates to false. Supports "tool == 'name'" or "path contains 'str'". */
  condition?: string;
  /** Output format for post hooks: "markdown" (default) or "plain". */
  format?: "markdown" | "plain";
  /** Whether to chain: pass previous hook output as input to next hook. */
  chain?: boolean;
  /** Optional per-hook Bubblewrap sandbox override. */
  sandbox?: boolean | HookSandboxConfig;
  /** Directory of the config file that declared this hook entry. */
  configDir?: string;
}

export interface HookConfig {
  preTool: HookEntry[];
  postTool: HookEntry[];
  sessionStart: HookEntry[];
  sandbox?: boolean | HookSandboxConfig;
}

export interface HooksSettings {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

export interface LoadHooksOptions {
  agentDir: string;
  workspaceRoot: string;
  trusted: boolean;
  onDiagnostic?: (message: string) => void;
}

export const CONFIG_FILE_NAME = "hooks.json";

const DEFAULT_TIMEOUT_MS = 10_000;

const KINDS = ["preTool", "postTool", "sessionStart"] as const;

type HookKind = (typeof KINDS)[number];

interface CacheEntry {
  config: HookConfig;
  diagnostics: string[];
  delivered: WeakSet<object>;
}

const CACHE = getMtimeCache<CacheEntry>("pi-hooks/config", {
  maxEntries: 8,
});

function statMtime(path: string): { mtime: number; error?: unknown } {
  try {
    return { mtime: statSync(path).mtimeMs };
  } catch (error) {
    return { mtime: -1, error };
  }
}

export {
  isHookSandboxEnabled,
  isHookSandboxOffline,
  resolveHookSandboxOptions,
};

const hookSandboxDiagnostic = (
  label: string,
  field: string | undefined,
  expected: string,
): string =>
  `ignoring ${field === undefined ? label : `${label}.${field}`}: must be ${expected}`;

function report(
  entry: CacheEntry,
  onDiagnostic?: (message: string) => void,
): void {
  if (onDiagnostic === undefined || entry.delivered.has(onDiagnostic)) return;
  entry.delivered.add(onDiagnostic);
  for (const diagnostic of entry.diagnostics) onDiagnostic(diagnostic);
}

export function emptyHookConfig(): HookConfig {
  return { preTool: [], postTool: [], sessionStart: [] };
}

export function isRelativeCommandPath(command: string): boolean {
  return (
    !isAbsolute(command) &&
    (command.includes("/") ||
      command.includes("\\") ||
      command === "." ||
      command === "..")
  );
}

export type ParsedCondition =
  | { kind: "always" }
  | { kind: "matches"; varName: string; regex: RegExp }
  | { kind: "tool"; op: "==" | "!="; value: string }
  | { kind: "pathContains"; value: string };

const MATCHES_CONDITION_RE =
  /^matches\(\s*([a-zA-Z0-9_]+)\s*,\s*['"](.*)['"]\s*\)$/i;
const TOOL_EQ_CONDITION_RE = /^(?:tool|toolname)\s*(==|!=)\s*['"](.+)['"]$/i;
const PATH_CONTAINS_CONDITION_RE = /^path\s+contains\s+['"](.+)['"]$/i;

export function parseCondition(rawCondition: string): ParsedCondition {
  const raw = rawCondition.trim();
  if (raw === "") return { kind: "always" };

  const matches = raw.match(MATCHES_CONDITION_RE);
  if (matches) {
    return {
      kind: "matches",
      varName: matches[1].toLowerCase(),
      regex: new RegExp(matches[2]),
    };
  }

  const toolMatch = raw.match(TOOL_EQ_CONDITION_RE);
  if (toolMatch) {
    return {
      kind: "tool",
      op: toolMatch[1] as "==" | "!=",
      value: toolMatch[2].toLowerCase(),
    };
  }

  const pathContains = raw.match(PATH_CONTAINS_CONDITION_RE);
  if (pathContains) {
    return { kind: "pathContains", value: pathContains[1].toLowerCase() };
  }

  throw new Error(`invalid hook condition: "${rawCondition}"`);
}

function validMatcher(matcher: string): boolean {
  const star = matcher.indexOf("*");
  return star === -1 || star === matcher.length - 1;
}

function validCondition(value: string): boolean {
  try {
    parseCondition(value);
    return true;
  } catch {
    return false;
  }
}

function parseEntry(
  value: unknown,
  kind: HookKind,
  index: number,
  diagnostics: string[],
  filePath?: string,
): HookEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    diagnostics.push(`ignoring ${kind}[${index}]: must be an object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rawCommand = record.command;
  if (typeof rawCommand !== "string" || rawCommand === "") {
    diagnostics.push(
      `ignoring ${kind}[${index}]: "command" must be a non-empty string`,
    );
    return undefined;
  }
  let command = rawCommand;
  const configDir = filePath !== undefined ? dirname(filePath) : undefined;
  const isRelative = isRelativeCommandPath(command);
  if (isRelative && configDir !== undefined) {
    command = resolve(configDir, command);
  }
  const args = record.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    diagnostics.push(`ignoring ${kind}[${index}]: "args" must be strings`);
    return undefined;
  }
  const matcher = record.matcher ?? "";
  if (typeof matcher !== "string" || !validMatcher(matcher)) {
    diagnostics.push(
      `ignoring ${kind}[${index}]: "matcher" must be a tool name or end with "*"`,
    );
    return undefined;
  }
  const timeoutMs = record.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    diagnostics.push(
      `ignoring ${kind}[${index}]: "timeoutMs" must be a positive number`,
    );
    return undefined;
  }
  const rawCondition = record.condition ?? record.if;
  const condition = typeof rawCondition === "string" ? rawCondition : undefined;
  if (condition !== undefined && !validCondition(condition)) {
    diagnostics.push(
      `ignoring ${kind}[${index}]: "condition" has invalid syntax`,
    );
    return undefined;
  }
  const format =
    record.format === "markdown" || record.format === "plain"
      ? record.format
      : undefined;
  const chain = record.chain === true ? true : undefined;
  const sandbox = parseSandboxConfig(
    record.sandbox,
    diagnostics,
    `${kind}[${index}].sandbox`,
    hookSandboxDiagnostic,
  );
  return {
    matcher,
    command,
    args: args as string[],
    timeoutMs,
    ...(condition ? { condition } : {}),
    ...(format ? { format } : {}),
    ...(chain ? { chain } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(isRelative && configDir ? { configDir } : {}),
  };
}

function parseFile(
  content: string,
  path: string,
  diagnostics: string[],
): HookConfig {
  const empty = emptyHookConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    diagnostics.push(`hooks file is not valid JSON: ${path}`);
    return empty;
  }
  if (!isRecord(parsed)) {
    diagnostics.push(`hooks file must be {"hooks": {...}}: ${path}`);
    return empty;
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "hooks" && key !== "sandbox") {
      diagnostics.push(`ignoring unknown key in hooks file: ${key}`);
    }
  }
  const sandbox = parseSandboxConfig(
    parsed.sandbox,
    diagnostics,
    "sandbox",
    hookSandboxDiagnostic,
  );
  const hooks = parsed.hooks;
  if (hooks === undefined) {
    return sandbox !== undefined ? { ...empty, sandbox } : empty;
  }
  if (!isRecord(hooks)) {
    diagnostics.push(`hooks file must be {"hooks": {...}}: ${path}`);
    return sandbox !== undefined ? { ...empty, sandbox } : empty;
  }
  const config: HookConfig = {
    ...emptyHookConfig(),
    ...(sandbox !== undefined ? { sandbox } : {}),
  };
  for (const key of Object.keys(hooks)) {
    const kind = KINDS.find((candidate) => candidate === key);
    if (kind === undefined) {
      diagnostics.push(`ignoring unknown hook kind: ${key}`);
      continue;
    }
    const list = hooks[key];
    if (!Array.isArray(list)) {
      diagnostics.push(`ignoring ${kind}: must be an array`);
      continue;
    }
    for (let index = 0; index < list.length; index += 1) {
      const parsedEntry = parseEntry(
        list[index],
        kind,
        index,
        diagnostics,
        path,
      );
      if (parsedEntry !== undefined) config[kind].push(parsedEntry);
    }
  }
  return config;
}

function readHooksFile(
  path: string,
  trusted: boolean,
  onDiagnostic?: (message: string) => void,
): HookConfig {
  const key = `${path}\0${trusted ? "1" : "0"}`;
  const stat = statMtime(path);
  const mtime = stat.mtime;
  const signature =
    mtime < 0 && stat.error && isPermissionError(stat.error)
      ? "perm-error"
      : String(mtime);
  const cached = CACHE.get(key, signature);
  if (cached !== undefined) {
    report(cached, onDiagnostic);
    return cached.config;
  }
  const diagnostics: string[] = [];
  let config = emptyHookConfig();
  if (mtime < 0) {
    if (stat.error && isPermissionError(stat.error)) {
      diagnostics.push(
        formatFsPermissionError("read hooks file", path, stat.error),
      );
    }
  } else if (!trusted) {
    diagnostics.push("ignoring .pi/hooks.json: project is not trusted");
  } else {
    try {
      config = parseFile(readFileSync(path, "utf8"), path, diagnostics);
    } catch (error) {
      diagnostics.push(
        isPermissionError(error)
          ? formatFsPermissionError("read hooks file", path, error)
          : `cannot read hooks file: ${path}`,
      );
    }
  }
  const entry: CacheEntry = {
    config,
    diagnostics,
    delivered: new WeakSet(),
  };
  CACHE.set(key, signature, entry);
  report(entry, onDiagnostic);
  return config;
}

export function clearHooksCache(): void {
  CACHE.clear();
}

function withFallbackSandbox(
  entries: HookEntry[],
  fallback: boolean | HookSandboxConfig | undefined,
): HookEntry[] {
  if (fallback === undefined) return [...entries];
  return entries.map((entry) =>
    entry.sandbox !== undefined ? entry : { ...entry, sandbox: fallback },
  );
}

export function loadAgentHooksConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): { config: HookConfig; path: string; diagnostics: string[] } {
  const path = join(agentDir, "hooks.json");
  const diagnostics: string[] = [];
  const config = readHooksFile(path, true, (message) => {
    diagnostics.push(message);
    onDiagnostic?.(message);
  });
  return { config, path, diagnostics };
}

/** Persist hooks sandbox settings in <agentDir>/hooks.json while preserving existing hooks. */
export function saveHooksSettings(
  agentDir: string,
  settings: HooksSettings,
): string {
  const path = saveSandboxConfig(join(agentDir, CONFIG_FILE_NAME), settings);
  clearHooksCache();
  return path;
}

export function loadProjectHooksConfig(
  workspaceRoot: string,
  trusted: boolean,
  onDiagnostic?: (message: string) => void,
): HookConfig {
  return readHooksFile(
    join(workspaceRoot, ".pi", "hooks.json"),
    trusted,
    onDiagnostic,
  );
}

export function loadHooks(options: LoadHooksOptions): HookConfig {
  const agent = readHooksFile(
    join(options.agentDir, "hooks.json"),
    true,
    options.onDiagnostic,
  );
  const overlay = loadProjectHooksConfig(
    options.workspaceRoot,
    options.trusted,
    options.onDiagnostic,
  );
  const sandbox = overlay.sandbox ?? agent.sandbox;
  return {
    preTool: [
      ...withFallbackSandbox(agent.preTool, sandbox),
      ...withFallbackSandbox(overlay.preTool, sandbox),
    ],
    postTool: [
      ...withFallbackSandbox(agent.postTool, sandbox),
      ...withFallbackSandbox(overlay.postTool, sandbox),
    ],
    sessionStart: [
      ...withFallbackSandbox(agent.sessionStart, sandbox),
      ...withFallbackSandbox(overlay.sessionStart, sandbox),
    ],
    ...(sandbox !== undefined ? { sandbox } : {}),
  };
}

export { formatBwrapProbeStatus } from "@hollowheap/pi-ui/sandbox-settings";

export function showHooksSettings(
  ctx: ExtensionContext,
  config: HookConfig,
  onSave: (settings: HooksSettings) => void,
  probeBwrap: () => BwrapProbeResult = () => probeBwrapAvailability(),
): Promise<void> {
  return showSandboxSettings({
    ctx,
    title: "Hooks settings",
    label: "Sandbox hooks (bwrap)",
    enabledDescription: (statusText) =>
      `Isolate hook commands in Bubblewrap (${statusText})`,
    offlineDescription:
      "Disable network access inside the hook sandbox (--unshare-net)",
    enabled: isHookSandboxEnabled(config.sandbox),
    offline: isHookSandboxOffline(config.sandbox),
    probeBwrap,
    onSave,
  });
}
