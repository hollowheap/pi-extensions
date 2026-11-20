import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ExtensionContext,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { loadPermissions } from "@hollowheap/core/config";
import {
  type ToolTextResult,
  displayPath,
  errorMessage,
  sanitizeTerminalText,
  toolTextResult,
} from "@hollowheap/core/format";
import { checkPath } from "@hollowheap/core/policy";
import { isRecord } from "@hollowheap/core/records";
import { resolveScopedPath } from "@hollowheap/core/scope";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { effectiveCwd } from "@hollowheap/core/state";
import type { Rule } from "@hollowheap/core/types";
import { notify } from "@hollowheap/pi-ui/host";
import { clampMaxResults } from "@hollowheap/runtime/exec";
import { markdownTheme } from "@hollowheap/ui/markdown";
import { Type } from "typebox";
import type { LspClient, LspClientOptions, LspPosition } from "./lsp.js";
import {
  type LanguageToolsConfig,
  findServer,
  loadLanguageToolsConfig,
  missingCommandHint,
  noServerHint,
} from "./settings.js";

const LSP_LOADED_KEY = Symbol.for("@hollowheap/pi-language-tools/lsp-loaded");
const MAX_FIELD_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

interface BoundedText {
  text: string;
  truncated: boolean;
}

function truncatedBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  let end = maxBytes;
  while (end > 0 && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) < 0xc0) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

function boundText(
  text: string,
  maxChars: number,
  maxBytes: number,
): BoundedText {
  const charTruncated = text.length > maxChars;
  const clipped = charTruncated ? text.slice(0, maxChars) : text;
  const byteTruncated = Buffer.byteLength(clipped, "utf8") > maxBytes;
  return {
    text: byteTruncated ? truncatedBytes(clipped, maxBytes) : clipped,
    truncated: charTruncated || byteTruncated,
  };
}

function boundField(text: string): BoundedText {
  return boundText(text, MAX_FIELD_CHARS, MAX_FIELD_CHARS * 4);
}

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
  const name = boundField(node.name).text;
  if (node.location !== undefined) {
    const path = pathForUri(node.location.uri);
    if (path === undefined || !pathAllowed(path, rules, root)) return undefined;
    return `${indent}${name} (${kindName(node.kind)}) ${displayPath(effective, path)}:${node.location.range.start.line + 1}`;
  }
  if (node.range !== undefined) {
    return `${indent}${name} (${kindName(node.kind)}) ${displayPath(effective, filePath)}:${node.range.start.line + 1}`;
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
    const containerField =
      typeof entry.containerName === "string" && entry.containerName !== ""
        ? boundField(entry.containerName)
        : undefined;
    if (containerField?.truncated) truncated = true;
    const container =
      containerField === undefined ? "" : ` [${containerField.text}]`;
    const kind = typeof entry.kind === "number" ? entry.kind : 0;
    lines.push(
      `${displayPath(effective, path)}:${line}:${column} ${boundField(entry.name).text} (${kindName(kind)})${container}`,
    );
  }
  return { lines, truncated };
}

function formatHover(value: unknown): BoundedText {
  const bounded = (text: string): BoundedText => boundField(text);
  let text = "No hover info.";
  let truncated = false;
  if (typeof value === "object" && value !== null) {
    const hover = value as { contents?: unknown };
    if (typeof hover.contents === "string") {
      const field = bounded(hover.contents);
      text = field.text;
      truncated = field.truncated;
    } else if (Array.isArray(hover.contents)) {
      const parts = hover.contents.map((c) => {
        const raw =
          typeof c === "string" ? c : ((c as { value?: string })?.value ?? "");
        const field = bounded(raw);
        truncated ||= field.truncated;
        return field.text;
      });
      text = parts.filter(Boolean).join("\n") || "No hover info.";
    } else if (typeof hover.contents === "object" && hover.contents !== null) {
      const c = hover.contents as { value?: string };
      if (typeof c.value === "string") {
        const field = bounded(c.value);
        text = field.text;
        truncated = field.truncated;
      }
    }
  }
  const result = boundText(text, MAX_OUTPUT_CHARS, MAX_OUTPUT_BYTES);
  return { text: result.text, truncated: truncated || result.truncated };
}

function documentationText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.value === "string") return value.value;
  return undefined;
}

function formatSignatureHelp(value: unknown): BoundedText {
  const fallback: BoundedText = {
    text: "No signature help.",
    truncated: false,
  };
  if (!isRecord(value) || !Array.isArray(value.signatures)) return fallback;
  const signatures = value.signatures.filter(
    (signature): signature is Record<string, unknown> =>
      isRecord(signature) && typeof signature.label === "string",
  );
  if (signatures.length === 0) return fallback;

  const activeIndex =
    typeof value.activeSignature === "number" &&
    Number.isInteger(value.activeSignature) &&
    value.activeSignature >= 0 &&
    value.activeSignature < signatures.length
      ? value.activeSignature
      : 0;
  const signature = signatures[activeIndex];
  if (signature === undefined) return fallback;

  let truncated = false;
  const add = (text: string): string => {
    const field = boundField(text);
    truncated ||= field.truncated;
    return field.text;
  };
  const lines = [add(signature.label as string)];
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
    lines.push(`Parameter: ${add(activeParameter.label)}`);
  }
  const parameterDoc = isRecord(activeParameter)
    ? documentationText(activeParameter.documentation)
    : undefined;
  if (parameterDoc !== undefined) lines.push(add(parameterDoc));
  const signatureDoc = documentationText(signature.documentation);
  if (signatureDoc !== undefined) lines.push(add(signatureDoc));
  const result = boundText(
    lines.join("\n"),
    MAX_OUTPUT_CHARS,
    MAX_OUTPUT_BYTES,
  );
  return { text: result.text, truncated: truncated || result.truncated };
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
    const message = boundField(
      typeof entry.message === "string" && entry.message.trim() !== ""
        ? entry.message
        : "diagnostic",
    );
    if (message.truncated) truncated = true;
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
      `${path}:${range.start.line + 1}:${range.start.character + 1} ${diagnosticSeverity(entry.severity)}${source}: ${message.text}${code}`,
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

function resultText(result: { content?: readonly unknown[] }): string {
  const item = result.content?.[0] as
    | { type?: string; text?: string }
    | undefined;
  return item && typeof item.text === "string" ? item.text : "";
}

function textResult(
  text: string,
  details: LangDetails,
): ToolTextResult<LangDetails> {
  const bounded = boundText(text, MAX_OUTPUT_CHARS, MAX_OUTPUT_BYTES);
  return toolTextResult(sanitizeTerminalText(bounded.text), {
    ...details,
    truncated: details.truncated || bounded.truncated,
  });
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
      notify(ctx, `pi-language-tools: ${message}`, "warning"),
  });
}

const defaultDeps: LangToolDeps = {
  loadConfig: loadLanguageToolsConfig,
  loadRules: defaultLoadRules,
  getClient: async (options) => {
    setLspLoaded(true);
    const { getLspClient, registerLspExitHook } = await import("./lsp.js");
    registerLspExitHook();
    return getLspClient(options);
  },
  getAgentDir,
};

const lspRequestCounts = new WeakMap<object, number>();

async function publishLspSnapshot(ctx: ExtensionContext): Promise<void> {
  const owner = ctx.sessionManager;
  if (typeof owner !== "object" || owner === null) return;
  const requestCount = (lspRequestCounts.get(owner) ?? 0) + 1;
  lspRequestCounts.set(owner, requestCount);
  try {
    const { listLspStatus } = await import("./lsp.js");
    updateSessionSnapshot(owner, "lsp", {
      servers: listLspStatus(owner, ctx.cwd),
      requestCount,
      updatedAt: Date.now(),
    });
  } catch {
    // Snapshot updates must never fail a lang call.
  }
}

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
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
  const absolute = resolveScopedPath(ctx.cwd, params.path, ctx.sessionManager);
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
      notify(ctx, `pi-language-tools: ${message}`, "warning"),
    );
  } catch (error) {
    return textResult(`lang: ${errorMessage(error)}`, pathDetails);
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
      language: languageId,
      ...(typeof ctx.sessionManager === "object" && ctx.sessionManager !== null
        ? { owner: ctx.sessionManager }
        : {}),
    });
    const cap = clampMaxResults(params.max_results);
    try {
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
        const hover = formatHover(raw);
        return textResult(hover.text, {
          ...pathDetails,
          count: 1,
          truncated: hover.truncated,
        });
      }

      if (action === "signature_help") {
        const raw = await client.signatureHelp(
          absolute,
          languageId,
          position as LspPosition,
        );
        const signature = formatSignatureHelp(raw);
        return textResult(signature.text, {
          ...pathDetails,
          count: signature.text === "No signature help." ? 0 : 1,
          truncated: signature.truncated,
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
          ? await client.definition(
              absolute,
              languageId,
              position as LspPosition,
            )
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
    } finally {
      await publishLspSnapshot(ctx);
    }
  } catch (error) {
    const message = errorMessage(error);
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
