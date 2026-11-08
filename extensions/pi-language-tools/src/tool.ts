import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionContext,
  type Theme,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme, Text } from "@earendil-works/pi-tui";
import { loadPermissions } from "@hollowheap/core/config";
import { displayPath } from "@hollowheap/core/format";
import { checkPath } from "@hollowheap/core/policy";
import { effectiveCwd } from "@hollowheap/core/state";
import type { Rule } from "@hollowheap/core/types";
import { clampMaxResults } from "@hollowheap/runtime/exec";
import { Type } from "typebox";
import {
  type LanguageToolsConfig,
  findServer,
  loadLanguageToolsConfig,
  missingCommandHint,
  noServerHint,
} from "./config.js";
import type { LspClient, LspClientOptions, LspPosition } from "./lsp.js";

const LSP_LOADED_KEY = Symbol.for("@hollowheap/pi-language-tools/lsp-loaded");

export function isLspLoaded(): boolean {
  return Boolean(
    (globalThis as unknown as Record<symbol, boolean>)[LSP_LOADED_KEY],
  );
}

export function setLspLoaded(loaded = true): void {
  (globalThis as unknown as Record<symbol, boolean>)[LSP_LOADED_KEY] = loaded;
}

export interface LangToolDeps {
  loadConfig: (
    agentDir: string,
    onDiagnostic?: (message: string) => void,
  ) => LanguageToolsConfig;
  loadRules: (ctx: ExtensionContext) => Rule[];
  getClient: (options: LspClientOptions) => LspClient | Promise<LspClient>;
  getAgentDir: () => string;
}

interface LangParams {
  action:
    | "definition"
    | "references"
    | "document_symbols"
    | "workspace_symbols"
    | "hover"
    | "signature_help"
    | "type_definition"
    | "implementation"
    | "document_highlights"
    | "diagnostics";
  path: string;
  line?: number;
  column?: number;
  query?: string;
  max_results?: number;
}

const ACTIONS = new Set<LangParams["action"]>([
  "definition",
  "references",
  "document_symbols",
  "workspace_symbols",
  "hover",
  "signature_help",
  "type_definition",
  "implementation",
  "document_highlights",
  "diagnostics",
]);

const POSITION_ACTIONS = new Set<LangParams["action"]>([
  "definition",
  "references",
  "hover",
  "signature_help",
  "type_definition",
  "implementation",
  "document_highlights",
]);

interface LangDetails {
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

function pathAllowed(
  path: string,
  rules: readonly Rule[],
  root: string,
): boolean {
  return checkPath(rules, path, "read", root) !== "deny";
}

function kindName(kind: number): string {
  return SYMBOL_KINDS[kind] || "symbol";
}

function formatLocation(
  location: ResultLocation,
  effective: string,
  root: string,
  rules: readonly Rule[],
): string | undefined {
  const path = pathForUri(location.uri);
  if (path === undefined || !pathAllowed(path, rules, root)) return undefined;
  return `${displayPath(effective, path)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

function formatLocations(
  value: unknown,
  effective: string,
  root: string,
  rules: readonly Rule[],
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  for (const location of toLocations(value)) {
    const formatted = formatLocation(location, effective, root, rules);
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
  effective: string,
  root: string,
  rules: readonly Rule[],
): string | undefined {
  const indent = "  ".repeat(depth);
  if (node.location !== undefined) {
    const path = pathForUri(node.location.uri);
    if (path === undefined || !pathAllowed(path, rules, root)) return undefined;
    return `${indent}${node.name} (${kindName(node.kind)}) ${displayPath(effective, path)}:${node.location.range.start.line + 1}`;
  }
  if (node.range !== undefined) {
    return `${indent}${node.name} (${kindName(node.kind)}) ${displayPath(effective, filePath)}:${node.range.start.line + 1}`;
  }
  return undefined;
}

function formatDocumentSymbols(
  value: unknown,
  filePath: string,
  effective: string,
  root: string,
  rules: readonly Rule[],
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;

  const walk = (nodes: SymbolNode[], depth: number): void => {
    for (const node of nodes) {
      if (truncated) return;
      const formatted = formatSymbolNode(
        node,
        filePath,
        depth,
        effective,
        root,
        rules,
      );
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
  effective: string,
  root: string,
  rules: readonly Rule[],
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
    if (path === undefined || !pathAllowed(path, rules, root)) continue;
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
      `${displayPath(effective, path)}:${line}:${column} ${entry.name} (${kindName(kind)})${container}`,
    );
  }
  return { lines, truncated };
}

function formatHover(value: unknown): string {
  if (typeof value !== "object" || value === null) return "No hover info.";
  const hover = value as { contents?: unknown; range?: unknown };
  if (typeof hover.contents === "string") return hover.contents;
  if (Array.isArray(hover.contents)) {
    const parts = hover.contents
      .map((c) =>
        typeof c === "string" ? c : ((c as { value?: string })?.value ?? ""),
      )
      .filter(Boolean);
    return parts.join("\n") || "No hover info.";
  }
  if (typeof hover.contents === "object" && hover.contents !== null) {
    const c = hover.contents as { value?: string; kind?: string };
    if (typeof c.value === "string") return c.value;
  }
  return "No hover info.";
}

function documentationText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.value === "string") return value.value;
  return undefined;
}

function formatSignatureHelp(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.signatures)) {
    return "No signature help.";
  }
  const signatures = value.signatures.filter(
    (signature): signature is Record<string, unknown> =>
      isRecord(signature) && typeof signature.label === "string",
  );
  if (signatures.length === 0) return "No signature help.";

  const activeIndex =
    typeof value.activeSignature === "number" &&
    Number.isInteger(value.activeSignature) &&
    value.activeSignature >= 0 &&
    value.activeSignature < signatures.length
      ? value.activeSignature
      : 0;
  const signature = signatures[activeIndex];
  if (signature === undefined) return "No signature help.";

  const lines = [signature.label];
  const parameters = Array.isArray(signature.parameters)
    ? signature.parameters
    : [];
  const activeParameter =
    typeof value.activeParameter === "number" &&
    Number.isInteger(value.activeParameter) &&
    value.activeParameter >= 0 &&
    value.activeParameter < parameters.length
      ? parameters[value.activeParameter]
      : undefined;
  if (isRecord(activeParameter) && typeof activeParameter.label === "string") {
    lines.push(`Parameter: ${activeParameter.label}`);
  }
  const parameterDoc = isRecord(activeParameter)
    ? documentationText(activeParameter.documentation)
    : undefined;
  if (parameterDoc !== undefined) lines.push(parameterDoc);
  const signatureDoc = documentationText(signature.documentation);
  if (signatureDoc !== undefined) lines.push(signatureDoc);
  return lines.join("\n");
}

function formatHighlights(
  value: unknown,
  filePath: string,
  effective: string,
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  if (!Array.isArray(value)) return { lines, truncated };
  const path = displayPath(effective, filePath);
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const range = rangeOf(entry.range);
    if (range === undefined) continue;
    if (lines.length >= cap) {
      truncated = true;
      break;
    }
    const kind =
      entry.kind === 2 ? "read" : entry.kind === 3 ? "write" : "text";
    lines.push(
      `${path}:${range.start.line + 1}:${range.start.character + 1} ${kind}`,
    );
  }
  return { lines, truncated };
}

function diagnosticSeverity(value: unknown): string {
  if (value === 1) return "error";
  if (value === 2) return "warning";
  if (value === 3) return "info";
  if (value === 4) return "hint";
  return "diagnostic";
}

function formatDiagnostics(
  value: unknown,
  filePath: string,
  effective: string,
  cap: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : [];
  const path = displayPath(effective, filePath);
  for (const entry of items) {
    if (!isRecord(entry)) continue;
    const range = rangeOf(entry.range);
    if (range === undefined) continue;
    const message =
      typeof entry.message === "string" && entry.message.trim() !== ""
        ? entry.message
        : "diagnostic";
    if (lines.length >= cap) {
      truncated = true;
      break;
    }
    const code =
      typeof entry.code === "string" || typeof entry.code === "number"
        ? ` [${String(entry.code)}]`
        : "";
    const source =
      typeof entry.source === "string" && entry.source !== ""
        ? ` ${entry.source}`
        : "";
    lines.push(
      `${path}:${range.start.line + 1}:${range.start.character + 1} ${diagnosticSeverity(entry.severity)}${source}: ${message}${code}`,
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

function markdownTheme(theme: Theme): MarkdownTheme {
  return {
    heading: (text) => theme.fg("accent", theme.bold(text)),
    link: (text) => theme.fg("accent", text),
    linkUrl: (text) => theme.fg("dim", text),
    code: (text) => theme.fg("toolOutput", text),
    codeBlock: (text) => theme.fg("toolOutput", text),
    codeBlockBorder: (text) => theme.fg("border", text),
    quote: (text) => theme.fg("muted", text),
    quoteBorder: (text) => theme.fg("border", text),
    hr: (text) => theme.fg("border", text),
    listBullet: (text) => theme.fg("accent", text),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
    strikethrough: (text) => theme.strikethrough(text),
    underline: (text) => theme.underline(text),
  };
}

function resultText(result: { content?: readonly unknown[] }): string {
  const item = result.content?.[0] as
    | { type?: string; text?: string }
    | undefined;
  return item && typeof item.text === "string" ? item.text : "";
}

function textResult(
  text: string,
  details: LangDetails,
): {
  content: { type: "text"; text: string }[];
  details: LangDetails;
} {
  return { content: [{ type: "text", text }], details };
}

function emptyResult(
  action: string,
  path: string,
  text: string,
  details: LangDetails,
): {
  content: { type: "text"; text: string }[];
  details: LangDetails;
} {
  return textResult(text, { ...details, action, path, count: 0 });
}

function defaultLoadRules(ctx: ExtensionContext): Rule[] {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) =>
      ctx.ui.notify(`pi-language-tools: ${message}`, "warning"),
  });
}

const defaultDeps: LangToolDeps = {
  loadConfig: loadLanguageToolsConfig,
  loadRules: defaultLoadRules,
  getClient: async (options) => {
    setLspLoaded(true);
    const { getLspClient } = await import("./lsp.js");
    return getLspClient(options);
  },
  getAgentDir,
};

export const langTool = createLangTool();

export function createLangTool(overrides: Partial<LangToolDeps> = {}) {
  const deps: LangToolDeps = { ...defaultDeps, ...overrides };

  return defineTool({
    name: "lang",
    label: "lang",
    description:
      "Read-only language tools from the project's language server. Actions: definition, references, document_symbols, workspace_symbols, hover, signature_help, type_definition, implementation, document_highlights, diagnostics. line and column are 1-based. Requires a trusted project and an installed language server.",
    exposure: "codemode",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("definition"),
        Type.Literal("references"),
        Type.Literal("document_symbols"),
        Type.Literal("workspace_symbols"),
        Type.Literal("hover"),
        Type.Literal("signature_help"),
        Type.Literal("type_definition"),
        Type.Literal("implementation"),
        Type.Literal("document_highlights"),
        Type.Literal("diagnostics"),
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
    renderResult(result, options, theme) {
      const text = resultText(result);
      if (options.expanded) {
        return new Markdown(text, 0, 0, markdownTheme(theme));
      }
      const lines = text.split("\n");
      const preview = lines.slice(0, 8).join("\n");
      const suffix = lines.length > 8 ? "\n... (expand to see more)" : "";
      return new Text(`${preview}${suffix}`, 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeLang(params as LangParams, ctx, deps);
    },
  });
}

async function executeLang(
  params: LangParams,
  ctx: ExtensionContext,
  deps: LangToolDeps,
): Promise<ReturnType<typeof textResult>> {
  const action = params.action;
  const details: LangDetails = {
    action,
    path: "",
    count: 0,
    truncated: false,
  };

  if (!ACTIONS.has(action)) {
    return textResult(`Unknown lang action: ${String(action)}.`, details);
  }

  if (!ctx.isProjectTrusted()) {
    return textResult(
      "lang requires a trusted project; language servers execute project code.",
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

  const position = POSITION_ACTIONS.has(action)
    ? inputPosition(params.line, params.column)
    : undefined;
  if (POSITION_ACTIONS.has(action) && position === undefined) {
    return textResult(
      `${action} requires 1-based line and column.`,
      pathDetails,
    );
  }
  if (action === "workspace_symbols" && typeof params.query !== "string") {
    return textResult("workspace_symbols requires a query.", pathDetails);
  }

  let config: LanguageToolsConfig;
  try {
    config = deps.loadConfig(deps.getAgentDir(), (message) =>
      ctx.ui?.notify?.(`pi-language-tools: ${message}`, "warning"),
    );
  } catch (error) {
    return textResult(
      `lang: ${error instanceof Error ? error.message : String(error)}`,
      pathDetails,
    );
  }
  const match = findServer(config, absolute);
  if (match === undefined) {
    return textResult(noServerHint(absolute, config.path), pathDetails);
  }
  const { server, languageId } = match;

  try {
    const client = await deps.getClient({
      name: server.name,
      command: server.command,
      args: server.args,
      root: ctx.cwd,
      timeoutMs: server.timeoutMs,
    });
    const cap = clampMaxResults(params.max_results);

    if (action === "workspace_symbols") {
      const raw = await client.workspaceSymbols(params.query ?? "");
      const { lines, truncated } = formatWorkspaceSymbols(
        raw,
        effective,
        ctx.cwd,
        rules,
        cap,
      );
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
        effective,
        ctx.cwd,
        rules,
        cap,
      );
      return formattedResult(
        lines,
        truncated,
        "No symbols found.",
        pathDetails,
      );
    }

    if (action === "hover") {
      const raw = await client.hover(
        absolute,
        languageId,
        position as LspPosition,
      );
      const text = formatHover(raw);
      return textResult(text, { ...pathDetails, count: 1, truncated: false });
    }

    if (action === "signature_help") {
      const raw = await client.signatureHelp(
        absolute,
        languageId,
        position as LspPosition,
      );
      const text = formatSignatureHelp(raw);
      return textResult(text, {
        ...pathDetails,
        count: text === "No signature help." ? 0 : 1,
        truncated: false,
      });
    }

    if (action === "type_definition" || action === "implementation") {
      const raw =
        action === "type_definition"
          ? await client.typeDefinition(
              absolute,
              languageId,
              position as LspPosition,
            )
          : await client.implementation(
              absolute,
              languageId,
              position as LspPosition,
            );
      const { lines, truncated } = formatLocations(
        raw,
        effective,
        ctx.cwd,
        rules,
        cap,
      );
      return formattedResult(
        lines,
        truncated,
        action === "type_definition"
          ? "No type definitions found."
          : "No implementations found.",
        pathDetails,
      );
    }

    if (action === "document_highlights") {
      const raw = await client.documentHighlights(
        absolute,
        languageId,
        position as LspPosition,
      );
      const { lines, truncated } = formatHighlights(
        raw,
        absolute,
        effective,
        cap,
      );
      return formattedResult(
        lines,
        truncated,
        "No highlights found.",
        pathDetails,
      );
    }

    if (action === "diagnostics") {
      const raw = await client.diagnostics(absolute, languageId);
      const { lines, truncated } = formatDiagnostics(
        raw,
        absolute,
        effective,
        cap,
      );
      return formattedResult(
        lines,
        truncated,
        "No diagnostics found.",
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
    const { lines, truncated } = formatLocations(
      raw,
      effective,
      ctx.cwd,
      rules,
      cap,
    );
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
    return textResult(`lang: ${message}`, pathDetails);
  }
}

function formattedResult(
  lines: string[],
  truncated: boolean,
  emptyText: string,
  details: LangDetails,
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
