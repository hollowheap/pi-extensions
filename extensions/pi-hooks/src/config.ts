import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  formatFsPermissionError,
  isPermissionError,
  updateJsonConfig,
} from "@hollowheap/core/config";
import { getMtimeCache } from "@hollowheap/core/mtime-cache";
import type { SandboxOptions } from "@hollowheap/runtime/sandbox";

export interface HookSandboxConfig {
  enabled: boolean;
  offline?: boolean;
  maskPaths?: string[];
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSandboxConfig(
  value: unknown,
  label: string,
  diagnostics: string[],
): boolean | HookSandboxConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) {
    diagnostics.push(`ignoring ${label}: must be a boolean or object`);
    return undefined;
  }

  let enabled: boolean | undefined;
  if (value.enabled !== undefined) {
    if (typeof value.enabled === "boolean") {
      enabled = value.enabled;
    } else {
      diagnostics.push(`ignoring ${label}.enabled: must be a boolean`);
    }
  }

  let offline: boolean | undefined;
  if (value.offline !== undefined) {
    if (typeof value.offline === "boolean") {
      offline = value.offline;
    } else {
      diagnostics.push(`ignoring ${label}.offline: must be a boolean`);
    }
  }

  let maskPaths: string[] | undefined;
  if (value.maskPaths !== undefined) {
    if (
      Array.isArray(value.maskPaths) &&
      value.maskPaths.every(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim() !== "",
      )
    ) {
      maskPaths = [...value.maskPaths];
    } else {
      diagnostics.push(
        `ignoring ${label}.maskPaths: must be an array of non-empty strings`,
      );
    }
  }

  const resolvedEnabled =
    enabled !== undefined
      ? enabled
      : offline !== undefined || maskPaths !== undefined;

  return {
    enabled: resolvedEnabled,
    ...(offline !== undefined ? { offline } : {}),
    ...(maskPaths !== undefined ? { maskPaths } : {}),
  };
}

export function resolveHookSandboxOptions(
  sandbox: boolean | HookSandboxConfig | undefined,
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

export function isHookSandboxEnabled(
  sandbox: boolean | HookSandboxConfig | undefined,
): boolean {
  if (sandbox === true) return true;
  return typeof sandbox === "object" && sandbox.enabled;
}

export function isHookSandboxOffline(
  sandbox: boolean | HookSandboxConfig | undefined,
): boolean {
  return typeof sandbox === "object" && sandbox.offline === true;
}

function report(
  entry: CacheEntry,
  onDiagnostic?: (message: string) => void,
): void {
  if (onDiagnostic === undefined || entry.delivered.has(onDiagnostic)) return;
  entry.delivered.add(onDiagnostic);
  for (const diagnostic of entry.diagnostics) onDiagnostic(diagnostic);
}

function validMatcher(matcher: string): boolean {
  const star = matcher.indexOf("*");
  return star === -1 || star === matcher.length - 1;
}

function validCondition(value: string): boolean {
  const raw = value.trim();
  if (raw === "") return true;
  const matches = raw.match(
    /^matches\(\s*([a-zA-Z0-9_]+)\s*,\s*['"](.*)['"]\s*\)$/i,
  );
  if (matches) {
    try {
      new RegExp(matches[2]);
      return true;
    } catch {
      return false;
    }
  }
  return (
    /^(?:tool|toolname)\s*(?:==|!=)\s*['"].+['"]$/i.test(raw) ||
    /^path\s+contains\s+['"].+['"]$/i.test(raw)
  );
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
  const isRelative =
    !isAbsolute(command) &&
    (command.includes("/") ||
      command.includes("\\") ||
      command === "." ||
      command === "..");
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
    `${kind}[${index}].sandbox`,
    diagnostics,
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
  const empty: HookConfig = { preTool: [], postTool: [], sessionStart: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    diagnostics.push(`hooks file is not valid JSON: ${path}`);
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    diagnostics.push(`hooks file must be {"hooks": {...}}: ${path}`);
    return empty;
  }
  const root = parsed as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (key !== "hooks" && key !== "sandbox") {
      diagnostics.push(`ignoring unknown key in hooks file: ${key}`);
    }
  }
  const sandbox = parseSandboxConfig(root.sandbox, "sandbox", diagnostics);
  const hooks = root.hooks;
  if (hooks === undefined) {
    return sandbox !== undefined ? { ...empty, sandbox } : empty;
  }
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    diagnostics.push(`hooks file must be {"hooks": {...}}: ${path}`);
    return sandbox !== undefined ? { ...empty, sandbox } : empty;
  }
  const config: HookConfig = {
    preTool: [],
    postTool: [],
    sessionStart: [],
    ...(sandbox !== undefined ? { sandbox } : {}),
  };
  const record = hooks as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const kind = KINDS.find((candidate) => candidate === key);
    if (kind === undefined) {
      diagnostics.push(`ignoring unknown hook kind: ${key}`);
      continue;
    }
    const list = record[key];
    if (!Array.isArray(list)) {
      diagnostics.push(`ignoring ${kind}: must be an array`);
      continue;
    }
    list.forEach((entry, index) => {
      const parsedEntry = parseEntry(entry, kind, index, diagnostics, path);
      if (parsedEntry !== undefined) config[kind].push(parsedEntry);
    });
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
  let config: HookConfig = { preTool: [], postTool: [], sessionStart: [] };
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
  const path = join(agentDir, "hooks.json");
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
  clearHooksCache();
  return res.path;
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
