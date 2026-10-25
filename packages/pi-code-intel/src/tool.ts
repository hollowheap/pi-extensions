import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  type Rule,
  checkPath,
  clampMaxResults,
  displayPath,
  effectiveCwd,
  loadPermissions,
} from "@hollowheap/core";
import {
  type CodeIntelConfig,
  type CodeIntelExposure,
  findServer,
  loadCodeIntelConfig,
  missingCommandHint,
  noServerHint,
} from "./config.js";
import {
  type LspClientOptions,
  type LspPosition,
  getLspClient,
} from "./lsp.js";

export interface CodeIntelClient {
  definition(
    filePath: string,
    languageId: string,
    position: LspPosition,
  ): Promise<unknown>;
  references(
    filePath: string,
    languageId: string,
    position: LspPosition,
  ): Promise<unknown>;
  documentSymbols(filePath: string, languageId: string): Promise<unknown>;
  workspaceSymbols(query: string): Promise<unknown>;
}

export interface CodeIntelDeps {
  loadConfig: (
    agentDir: string,
    onDiagnostic?: (message: string) => void,
  ) => CodeIntelConfig;
  loadRules: (ctx: ExtensionContext) => Rule[];
  getClient: (options: LspClientOptions) => CodeIntelClient;
  getAgentDir: () => string;
}

interface CodeIntelParams {
  action:
    | "definition"
    | "references"
    | "document_symbols"
    | "workspace_symbols";
  path: string;
  line?: number;
  column?: number;
  query?: string;
  max_results?: number;
}

interface CodeIntelDetails {
  action: string;
  path: string;
  count: number;
  truncated: boolean;
}

interface ToolRange {
  start: LspPosition;
  end: LspPosition;
}

interface ResultLocation {
  uri: string;
  range: ToolRange;
}

interface WorkspaceLocation {
  uri: string;
  range?: ToolRange;
}

interface SymbolNode {
  name: string;
  kind: number;
  range?: ToolRange;
  location?: ResultLocation;
  children: SymbolNode[];
}

interface FormatContext {
  effective: string;
  root: string;
  rules: readonly Rule[];
}

const SYMBOL_KINDS: readonly string[] = [
  "",
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enummember",
  "struct",
  "event",
  "operator",
  "typeparameter",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positionOf(value: unknown): LspPosition | undefined {
  if (!isRecord(value)) return undefined;
  const line = value.line;
  const character = value.character;
  if (typeof line !== "number" || typeof character !== "number") {
    return undefined;
  }
  if (
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return undefined;
  }
  return { line, character };
}

function rangeOf(value: unknown): ToolRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = positionOf(value.start);
  const end = positionOf(value.end);
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

function locationOf(value: unknown): ResultLocation | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.uri === "string") {
    const range = rangeOf(value.range);
    return range === undefined ? undefined : { uri: value.uri, range };
  }
  if (typeof value.targetUri === "string") {
    const range =
      rangeOf(value.targetSelectionRange) ?? rangeOf(value.targetRange);
    return range === undefined ? undefined : { uri: value.targetUri, range };
  }
  return undefined;
}

function locationField(
  value: Record<string, unknown>,
): ResultLocation | undefined {
  const location = value.location;
  return isRecord(location) ? locationOf(location) : undefined;
}

function toLocations(value: unknown): ResultLocation[] {
  if (Array.isArray(value)) {
    const locations: ResultLocation[] = [];
    for (const entry of value) {
      const location = locationOf(entry);
      if (location !== undefined) locations.push(location);
    }
    return locations;
  }
  const location = locationOf(value);
  return location === undefined ? [] : [location];
}

function pathForUri(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function pathAllowed(path: string, ctx: FormatContext): boolean {
  return checkPath(ctx.rules, path, "read", ctx.root) !== "deny";
}

function kindName(kind: number): string {
  return SYMBOL_KINDS[kind] || "symbol";
}

function formatLocation(
  location: ResultLocation,
  ctx: FormatContext,
): string | undefined {
  const path = pathForUri(location.uri);
  if (path === undefined || !pathAllowed(path, ctx)) return undefined;
  return `${displayPath(ctx.effective, path)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

function formatLocations(
  value: unknown,
  ctx: FormatContext,
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  for (const location of toLocations(value)) {
    const formatted = formatLocation(location, ctx);
    if (formatted === undefined) continue;
    if (lines.length >= cap) {
      truncated = true;
      break;
    }
    lines.push(formatted);
  }
  return { lines, truncated };
}

function toSymbolNodes(value: unknown): SymbolNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: SymbolNode[] = [];
  for (const entry of value) {
    const node = toSymbolNode(entry);
    if (node !== undefined) nodes.push(node);
  }
  return nodes;
}

function toSymbolNode(value: unknown): SymbolNode | undefined {
  if (!isRecord(value) || typeof value.name !== "string") return undefined;
  const range = rangeOf(value.range) ?? rangeOf(value.selectionRange);
  const location = locationField(value);
  if (range === undefined && location === undefined) return undefined;
  return {
    name: value.name,
    kind: typeof value.kind === "number" ? value.kind : 0,
    ...(range === undefined ? {} : { range }),
    ...(location === undefined ? {} : { location }),
    children: toSymbolNodes(value.children),
  };
}

function formatSymbolNode(
  node: SymbolNode,
  filePath: string,
  depth: number,
  ctx: FormatContext,
): string | undefined {
  const indent = "  ".repeat(depth);
  if (node.location !== undefined) {
    const path = pathForUri(node.location.uri);
    if (path === undefined || !pathAllowed(path, ctx)) return undefined;
    return `${indent}${node.name} (${kindName(node.kind)}) ${displayPath(ctx.effective, path)}:${node.location.range.start.line + 1}`;
  }
  if (node.range !== undefined) {
    return `${indent}${node.name} (${kindName(node.kind)}) ${displayPath(ctx.effective, filePath)}:${node.range.start.line + 1}`;
  }
  return undefined;
}

function formatDocumentSymbols(
  value: unknown,
  filePath: string,
  ctx: FormatContext,
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;

  const walk = (nodes: SymbolNode[], depth: number): void => {
    for (const node of nodes) {
      if (truncated) return;
      const formatted = formatSymbolNode(node, filePath, depth, ctx);
      if (formatted !== undefined) {
        if (lines.length >= cap) {
          truncated = true;
          return;
        }
        lines.push(formatted);
      }
      walk(node.children, depth + 1);
    }
  };

  walk(toSymbolNodes(value), 0);
  return { lines, truncated };
}

function workspaceLocation(value: unknown): WorkspaceLocation | undefined {
  if (!isRecord(value) || typeof value.uri !== "string") return undefined;
  const range = rangeOf(value.range);
  return { uri: value.uri, ...(range === undefined ? {} : { range }) };
}

function formatWorkspaceSymbols(
  value: unknown,
  ctx: FormatContext,
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  if (!Array.isArray(value)) return { lines, truncated };

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    const location = workspaceLocation(entry.location);
    if (location === undefined) continue;
    const path = pathForUri(location.uri);
    if (path === undefined || !pathAllowed(path, ctx)) continue;
    if (lines.length >= cap) {
      truncated = true;
      break;
    }
    const line = (location.range?.start.line ?? 0) + 1;
    const column = (location.range?.start.character ?? 0) + 1;
    const container =
      typeof entry.containerName === "string" && entry.containerName !== ""
        ? ` [${entry.containerName}]`
        : "";
    const kind = typeof entry.kind === "number" ? entry.kind : 0;
    lines.push(
      `${displayPath(ctx.effective, path)}:${line}:${column} ${entry.name} (${kindName(kind)})${container}`,
    );
  }
  return { lines, truncated };
}

function inputPosition(
  line: number | undefined,
  column: number | undefined,
): LspPosition | undefined {
  if (
    line === undefined ||
    column === undefined ||
    !Number.isInteger(line) ||
    !Number.isInteger(column) ||
    line < 1 ||
    column < 1
  ) {
    return undefined;
  }
  return { line: line - 1, character: column - 1 };
}

function textResult(
  text: string,
  details: CodeIntelDetails,
): {
  content: { type: "text"; text: string }[];
  details: CodeIntelDetails;
} {
  return { content: [{ type: "text", text }], details };
}

function emptyResult(
  action: string,
  path: string,
  text: string,
  details: CodeIntelDetails,
): {
  content: { type: "text"; text: string }[];
  details: CodeIntelDetails;
} {
  return textResult(text, { ...details, action, path, count: 0 });
}

function defaultLoadRules(ctx: ExtensionContext): Rule[] {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) =>
      ctx.ui.notify(`pi-code-intel: ${message}`, "warning"),
  });
}

const defaultDeps: CodeIntelDeps = {
  loadConfig: loadCodeIntelConfig,
  loadRules: defaultLoadRules,
  getClient: getLspClient,
  getAgentDir,
};

export const codeIntelTool = createCodeIntelTool();

export function createCodeIntelTool(
  overrides: Partial<CodeIntelDeps> = {},
  exposure: CodeIntelExposure = "direct",
) {
  const deps: CodeIntelDeps = { ...defaultDeps, ...overrides };

  return defineTool({
    name: "code_intel",
    label: "code_intel",
    description:
      "Read-only code intelligence from the project's language server. Actions: definition, references, document_symbols, workspace_symbols. line and column are 1-based. Requires a trusted project and an installed language server.",
    exposure,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("definition"),
        Type.Literal("references"),
        Type.Literal("document_symbols"),
        Type.Literal("workspace_symbols"),
      ]),
      path: Type.String({
        description:
          "File used to choose the language server; relative to the working directory",
      }),
      line: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: "1-based line for definition and references",
        }),
      ),
      column: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: "1-based column for definition and references",
        }),
      ),
      query: Type.Optional(
        Type.String({ description: "Symbol query for workspace_symbols" }),
      ),
      max_results: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 500,
          default: 100,
          description: "Maximum results to return",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeCodeIntel(params as CodeIntelParams, ctx, deps);
    },
  });
}

async function executeCodeIntel(
  params: CodeIntelParams,
  ctx: ExtensionContext,
  deps: CodeIntelDeps,
): Promise<ReturnType<typeof textResult>> {
  const action = params.action;
  const details: CodeIntelDetails = {
    action,
    path: "",
    count: 0,
    truncated: false,
  };

  if (!ctx.isProjectTrusted()) {
    return textResult(
      "code_intel requires a trusted project; language servers execute project code.",
      details,
    );
  }

  if (typeof params.path !== "string" || params.path.trim() === "") {
    return textResult(`${action} requires a path.`, details);
  }

  const effective = effectiveCwd(ctx.cwd, ctx.sessionManager);
  const absolute = resolve(effective, params.path);
  const display = displayPath(effective, absolute);
  const pathDetails = { ...details, path: display };
  const rules = deps.loadRules(ctx);
  if (checkPath(rules, absolute, "read", ctx.cwd) === "deny") {
    return textResult(
      `Path denied by permission rules: ${display}`,
      pathDetails,
    );
  }

  let isFile = false;
  try {
    isFile = statSync(absolute).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) return textResult(`Not a file: ${display}`, pathDetails);

  const position =
    action === "definition" || action === "references"
      ? inputPosition(params.line, params.column)
      : undefined;
  if (
    (action === "definition" || action === "references") &&
    position === undefined
  ) {
    return textResult(
      `${action} requires 1-based line and column.`,
      pathDetails,
    );
  }
  if (action === "workspace_symbols" && typeof params.query !== "string") {
    return textResult("workspace_symbols requires a query.", pathDetails);
  }

  const config = deps.loadConfig(deps.getAgentDir(), (message) =>
    ctx.ui.notify(`pi-code-intel: ${message}`, "warning"),
  );
  const match = findServer(config, absolute);
  if (match === undefined) {
    return textResult(noServerHint(absolute, config.path), pathDetails);
  }
  const { server, languageId } = match;

  try {
    const client = deps.getClient({
      name: server.name,
      command: server.command,
      args: server.args,
      root: ctx.cwd,
      timeoutMs: server.timeoutMs,
    });
    const formatCtx: FormatContext = {
      effective,
      root: ctx.cwd,
      rules,
    };
    const cap = clampMaxResults(params.max_results);

    if (action === "workspace_symbols") {
      const raw = await client.workspaceSymbols(params.query ?? "");
      const { lines, truncated } = formatWorkspaceSymbols(raw, formatCtx, cap);
      return formattedResult(
        lines,
        truncated,
        "No workspace symbols found.",
        pathDetails,
      );
    }

    if (action === "document_symbols") {
      const raw = await client.documentSymbols(absolute, languageId);
      const { lines, truncated } = formatDocumentSymbols(
        raw,
        absolute,
        formatCtx,
        cap,
      );
      return formattedResult(
        lines,
        truncated,
        "No symbols found.",
        pathDetails,
      );
    }

    const raw =
      action === "definition"
        ? await client.definition(absolute, languageId, position as LspPosition)
        : await client.references(
            absolute,
            languageId,
            position as LspPosition,
          );
    const { lines, truncated } = formatLocations(raw, formatCtx, cap);
    return formattedResult(
      lines,
      truncated,
      action === "definition"
        ? "No definitions found."
        : "No references found.",
      pathDetails,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\bENOENT\b/.test(message)) {
      return textResult(missingCommandHint(server, config.path), pathDetails);
    }
    return textResult(`code_intel: ${message}`, pathDetails);
  }
}

function formattedResult(
  lines: string[],
  truncated: boolean,
  emptyText: string,
  details: CodeIntelDetails,
): ReturnType<typeof textResult> {
  if (lines.length === 0) {
    return emptyResult(details.action, details.path, emptyText, details);
  }
  const suffix = truncated ? "\n... (truncated)" : "";
  return textResult(`${lines.join("\n")}${suffix}`, {
    ...details,
    count: lines.length,
    truncated,
  });
}
