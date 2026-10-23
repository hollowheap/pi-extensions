import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const CONFIG_FILE_NAME = "code-intel.json";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 60_000;

export type ServerSource = "builtin" | "config";

export interface ServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly extensions: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly source: ServerSource;
}

export interface CodeIntelConfig {
  readonly servers: readonly ServerConfig[];
  readonly path: string;
  readonly diagnostics: readonly string[];
}

const CACHE_KEY = Symbol.for("@hollowheap/pi-code-intel/config");
const MAX_CACHE_ENTRIES = 16;

interface ConfigEntry {
  mtimeMs: number;
  size: number;
  servers: readonly ServerConfig[];
  diagnostics: readonly string[];
  reported: boolean;
}

type ConfigCache = Map<string, ConfigEntry>;

function getCache(): ConfigCache {
  const store = globalThis as unknown as Record<
    symbol,
    ConfigCache | undefined
  >;
  const existing = store[CACHE_KEY];
  if (existing !== undefined) return existing;
  const created: ConfigCache = new Map();
  store[CACHE_KEY] = created;
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeServer(
  name: string,
  command: string,
  args: readonly string[],
  extensions: Readonly<Record<string, string>>,
  timeoutMs: number,
  source: ServerSource,
): ServerConfig {
  return Object.freeze({
    name,
    command,
    args: Object.freeze([...args]),
    extensions: Object.freeze({ ...extensions }),
    timeoutMs,
    source,
  });
}

function builtin(
  name: string,
  command: string,
  args: readonly string[],
  extensions: Readonly<Record<string, string>>,
): ServerConfig {
  return makeServer(
    name,
    command,
    args,
    extensions,
    DEFAULT_TIMEOUT_MS,
    "builtin",
  );
}

export const BUILTIN_SERVERS: readonly ServerConfig[] = Object.freeze([
  builtin("typescript", "typescript-language-server", ["--stdio"], {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
  }),
  builtin("python", "pyright-langserver", ["--stdio"], {
    ".py": "python",
    ".pyi": "python",
  }),
  builtin("rust", "rust-analyzer", [], { ".rs": "rust" }),
  builtin("go", "gopls", [], { ".go": "go" }),
  builtin("clangd", "clangd", [], {
    ".c": "c",
    ".h": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hh": "cpp",
  }),
  builtin("lua", "lua-language-server", [], { ".lua": "lua" }),
]);

function fileStats(path: string): { mtimeMs: number; size: number } {
  try {
    const stats = statSync(path);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return { mtimeMs: -1, size: -1 };
  }
}

function parseServer(
  name: string,
  input: unknown,
  diagnostics: string[],
): ServerConfig | undefined {
  if (!isRecord(input)) {
    diagnostics.push(`ignoring server "${name}": must be an object`);
    return undefined;
  }

  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (command === "") {
    diagnostics.push(
      `ignoring server "${name}": "command" must be a non-empty string`,
    );
    return undefined;
  }

  let args: string[] = [];
  if (input.args !== undefined) {
    if (
      Array.isArray(input.args) &&
      input.args.every((arg) => typeof arg === "string")
    ) {
      args = [...input.args];
    } else {
      diagnostics.push(`ignoring server "${name}": "args" must be strings`);
      return undefined;
    }
  }

  if (!isRecord(input.extensions)) {
    diagnostics.push(
      `ignoring server "${name}": "extensions" must be an object`,
    );
    return undefined;
  }
  const extensions: Record<string, string> = {};
  for (const [suffix, languageId] of Object.entries(input.extensions)) {
    if (
      !suffix.startsWith(".") ||
      suffix.length < 2 ||
      typeof languageId !== "string" ||
      languageId === ""
    ) {
      diagnostics.push(
        `ignoring server "${name}": extensions must map suffixes like ".ts" to a language id`,
      );
      return undefined;
    }
    extensions[suffix] = languageId;
  }
  if (Object.keys(extensions).length === 0) {
    diagnostics.push(
      `ignoring server "${name}": "extensions" must not be empty`,
    );
    return undefined;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (input.timeoutMs !== undefined) {
    if (
      typeof input.timeoutMs === "number" &&
      Number.isInteger(input.timeoutMs) &&
      input.timeoutMs > 0 &&
      input.timeoutMs <= MAX_TIMEOUT_MS
    ) {
      timeoutMs = input.timeoutMs;
    } else {
      diagnostics.push(
        `ignoring server "${name}": "timeoutMs" must be an integer between 1 and ${MAX_TIMEOUT_MS}`,
      );
      return undefined;
    }
  }

  return makeServer(name, command, args, extensions, timeoutMs, "config");
}

function parseServers(
  parsed: Record<string, unknown>,
  diagnostics: string[],
): ServerConfig[] {
  if (parsed.servers === undefined) return [];
  if (!isRecord(parsed.servers)) {
    diagnostics.push('"servers" must be an object; using built-in servers');
    return [];
  }

  const userServers: ServerConfig[] = [];
  const claimed = new Map<string, string>();
  for (const [name, value] of Object.entries(parsed.servers)) {
    if (name === "") {
      diagnostics.push("ignoring server with an empty name");
      continue;
    }
    const server = parseServer(name, value, diagnostics);
    if (server === undefined) continue;

    const extensions: Record<string, string> = {};
    for (const [suffix, languageId] of Object.entries(server.extensions)) {
      const owner = claimed.get(suffix);
      if (owner !== undefined) {
        diagnostics.push(
          `server "${name}" ignores duplicate extension "${suffix}" already claimed by "${owner}"`,
        );
        continue;
      }
      claimed.set(suffix, name);
      extensions[suffix] = languageId;
    }
    if (Object.keys(extensions).length === 0) {
      diagnostics.push(
        `ignoring server "${name}": no extensions left after duplicate filtering`,
      );
      continue;
    }
    userServers.push(
      Object.keys(extensions).length === Object.keys(server.extensions).length
        ? server
        : makeServer(
            server.name,
            server.command,
            server.args,
            extensions,
            server.timeoutMs,
            "config",
          ),
    );
  }
  return userServers;
}

function readServers(
  path: string,
  mtimeMs: number,
  diagnostics: string[],
): readonly ServerConfig[] {
  if (mtimeMs < 0) return BUILTIN_SERVERS;
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    diagnostics.push(`cannot read code-intel config: ${path}`);
    return BUILTIN_SERVERS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    diagnostics.push(`${path} is not valid JSON; using built-in servers`);
    return BUILTIN_SERVERS;
  }
  if (!isRecord(parsed)) {
    diagnostics.push(
      "code-intel config root must be an object; using built-in servers",
    );
    return BUILTIN_SERVERS;
  }

  const userServers = parseServers(parsed, diagnostics);
  const overridden = new Set(userServers.map((server) => server.name));
  const builtins = BUILTIN_SERVERS.filter(
    (server) => !overridden.has(server.name),
  );
  return [...userServers, ...builtins];
}

function report(
  entry: ConfigEntry,
  onDiagnostic?: (message: string) => void,
): void {
  if (
    entry.reported ||
    entry.diagnostics.length === 0 ||
    onDiagnostic === undefined
  ) {
    return;
  }
  entry.reported = true;
  for (const diagnostic of entry.diagnostics) onDiagnostic(diagnostic);
}

function store(path: string, entry: ConfigEntry): void {
  const cache = getCache();
  cache.set(path, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function loadCodeIntelConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): CodeIntelConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const stats = fileStats(path);
  const cached = getCache().get(path);
  if (
    cached !== undefined &&
    cached.mtimeMs === stats.mtimeMs &&
    cached.size === stats.size
  ) {
    report(cached, onDiagnostic);
    return {
      servers: cached.servers,
      path,
      diagnostics: cached.diagnostics,
    };
  }

  const diagnostics: string[] = [];
  const servers = readServers(path, stats.mtimeMs, diagnostics);
  const entry: ConfigEntry = {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    servers,
    diagnostics: Object.freeze(diagnostics),
    reported: false,
  };
  store(path, entry);
  report(entry, onDiagnostic);
  return { servers, path, diagnostics: entry.diagnostics };
}

export function findServer(
  config: CodeIntelConfig,
  filePath: string,
): { server: ServerConfig; languageId: string } | undefined {
  const suffix = extname(filePath);
  if (suffix === "") return undefined;
  for (const server of config.servers) {
    const languageId = server.extensions[suffix];
    if (languageId !== undefined) return { server, languageId };
  }
  return undefined;
}

export function missingCommandHint(
  server: ServerConfig,
  configPath: string,
): string {
  return `Language server "${server.command}" was not found. Install it or configure servers.${server.name} in ${configPath}.`;
}

export function noServerHint(filePath: string, configPath: string): string {
  const suffix = extname(filePath);
  return `No language server configured for ${suffix || filePath}. Add one to ${configPath}.`;
}
