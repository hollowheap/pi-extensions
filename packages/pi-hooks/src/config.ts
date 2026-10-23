import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface HookEntry {
  /** Exact tool name, a trailing "*" prefix, or "" for every tool. */
  matcher: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface HookConfig {
  preTool: HookEntry[];
  postTool: HookEntry[];
}

export interface LoadHooksOptions {
  agentDir: string;
  workspaceRoot: string;
  trusted: boolean;
  onDiagnostic?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const KINDS = ["preTool", "postTool"] as const;

type HookKind = (typeof KINDS)[number];

interface CacheEntry {
  mtimeMs: number;
  config: HookConfig;
  diagnostics: string[];
  reported: boolean;
}

// One reader, one module instance: the cache lives here rather than on the
// shared core registry.
const CACHE = new Map<string, CacheEntry>();

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function report(
  entry: CacheEntry,
  onDiagnostic?: (message: string) => void,
): void {
  if (entry.reported || onDiagnostic === undefined) return;
  entry.reported = true;
  for (const diagnostic of entry.diagnostics) onDiagnostic(diagnostic);
}

function validMatcher(matcher: string): boolean {
  const star = matcher.indexOf("*");
  return star === -1 || star === matcher.length - 1;
}

function parseEntry(
  value: unknown,
  kind: HookKind,
  index: number,
  diagnostics: string[],
): HookEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    diagnostics.push(`ignoring ${kind}[${index}]: must be an object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const command = record.command;
  if (typeof command !== "string" || command === "") {
    diagnostics.push(
      `ignoring ${kind}[${index}]: "command" must be a non-empty string`,
    );
    return undefined;
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
  return { matcher, command, args: args as string[], timeoutMs };
}

function parseFile(
  content: string,
  path: string,
  diagnostics: string[],
): HookConfig {
  const empty: HookConfig = { preTool: [], postTool: [] };
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
    if (key !== "hooks") {
      diagnostics.push(`ignoring unknown key in hooks file: ${key}`);
    }
  }
  const hooks = root.hooks;
  if (hooks === undefined) return empty;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    diagnostics.push(`hooks file must be {"hooks": {...}}: ${path}`);
    return empty;
  }
  const config: HookConfig = { preTool: [], postTool: [] };
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
      const parsedEntry = parseEntry(entry, kind, index, diagnostics);
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
  const mtime = mtimeMs(path);
  const cached = CACHE.get(key);
  if (cached !== undefined && cached.mtimeMs === mtime) {
    report(cached, onDiagnostic);
    return cached.config;
  }
  const diagnostics: string[] = [];
  let config: HookConfig = { preTool: [], postTool: [] };
  if (mtime < 0) {
    // No file, nothing to load.
  } else if (!trusted) {
    diagnostics.push("ignoring .pi/hooks.json: project is not trusted");
  } else {
    try {
      config = parseFile(readFileSync(path, "utf8"), path, diagnostics);
    } catch {
      diagnostics.push(`cannot read hooks file: ${path}`);
    }
  }
  const entry: CacheEntry = {
    mtimeMs: mtime,
    config,
    diagnostics,
    reported: false,
  };
  CACHE.set(key, entry);
  report(entry, onDiagnostic);
  return config;
}

export function loadHooks(options: LoadHooksOptions): HookConfig {
  const agent = readHooksFile(
    join(options.agentDir, "hooks.json"),
    true,
    options.onDiagnostic,
  );
  const overlay = readHooksFile(
    join(options.workspaceRoot, ".pi", "hooks.json"),
    options.trusted,
    options.onDiagnostic,
  );
  return {
    preTool: [...agent.preTool, ...overlay.preTool],
    postTool: [...agent.postTool, ...overlay.postTool],
  };
}
