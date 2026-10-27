import { Type } from "@earendil-works/pi-ai";
import {
  type Theme,
  defineTool,
  getAgentDir,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadWebConfig } from "./config.js";
import { fetchUrl } from "./fetch.js";
import { createExaAdapter } from "./providers/exa.js";
import { createFirecrawlAdapter } from "./providers/firecrawl.js";
import {
  providerSignal,
  resolveFetchOrder,
  resolveSearchOrder,
  withProviderFallback,
} from "./providers/selection.js";
import { createTavilyAdapter } from "./providers/tavily.js";
import type {
  FetchProvider,
  FetchRequest,
  NormalizedFetchResult,
  NormalizedSearchResult,
  ProviderAdapter,
  ProviderId,
  SearchRequest,
} from "./providers/types.js";

export const SEARCH_DEFAULT_RESULTS = 5;
export const SEARCH_MAX_RESULTS = 10;
export const FETCH_DEFAULT_CHARS = 20_000;
export const FETCH_MAX_CHARS = 100_000;
export const FETCH_MAX_LINKS = 50;
export const FETCH_MAX_MEDIA = 20;

function expandHint(theme: Theme, count: number, noun: string): string {
  let hint = "to expand";
  try {
    hint = keyHint("app.tools.expand", "to expand");
  } catch {
    hint = "[Space] to expand";
  }
  return `${theme.fg("muted", `... (${count} more ${noun},`)} ${hint}${theme.fg("muted", ")")}`;
}

export interface WebSearchDeps {
  search?: (request: SearchRequest) => Promise<NormalizedSearchResult[]>;
}

export interface WebFetchDeps {
  fetch?: (request: FetchRequest) => Promise<NormalizedFetchResult>;
}

function adapterFor(provider: ProviderId): ProviderAdapter {
  if (provider === "exa") return createExaAdapter();
  if (provider === "tavily") return createTavilyAdapter();
  return createFirecrawlAdapter();
}

function fetchAdapterFor(provider: FetchProvider): ProviderAdapter {
  if (provider === "exa") return createExaAdapter();
  return createTavilyAdapter();
}

async function defaultSearch(
  request: SearchRequest,
): Promise<NormalizedSearchResult[]> {
  const config = loadWebConfig(getAgentDir());
  const order = resolveSearchOrder(config.searchOrder);
  const signal = providerSignal(request.signal);
  return withProviderFallback(
    order,
    (provider) => adapterFor(provider).search({ ...request, signal }),
    signal,
  );
}

async function defaultFetch(
  request: FetchRequest,
): Promise<NormalizedFetchResult> {
  const config = loadWebConfig(getAgentDir());
  const order = resolveFetchOrder(config.fetchOrder);
  const providers = order
    .filter((provider) => provider !== "raw")
    .map((provider) => fetchAdapterFor(provider));
  return fetchUrl(request.url, {
    apiKey: request.apiKey,
    signal: request.signal,
    providers,
  });
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

function normalizeSearch(item: NormalizedSearchResult): WebSearchResultItem {
  return {
    title: item.title,
    url: item.url,
    snippet: item.snippet,
  };
}

function formatSearchMarkdown(
  query: string,
  results: readonly WebSearchResultItem[],
  truncated: boolean,
): string {
  if (results.length === 0) {
    return `No search results found for "${query}".`;
  }
  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. [${r.title}](${r.url})`);
    if (r.snippet) {
      lines.push(`   ${r.snippet.trim()}`);
    }
  }
  if (truncated) {
    lines.push(`\n[Search results truncated to ${results.length} items]`);
  }
  return lines.join("\n");
}

function formatFetchMarkdown(
  url: string,
  finalUrl: string,
  content: string,
  links: readonly { title?: string; text?: string; url: string }[],
  isTruncated: boolean,
): string {
  const parts: string[] = [];
  if (finalUrl && finalUrl !== url) {
    parts.push(`*Redirected to: ${finalUrl}*\n`);
  }
  parts.push(content.trim());
  if (isTruncated) {
    parts.push(`\n\n[Content truncated to ${content.length} characters]`);
  }
  if (links.length > 0) {
    parts.push("\n\n## Page Links");
    for (const link of links) {
      const label = link.text || link.title || link.url;
      parts.push(`- [${label}](${link.url})`);
    }
  }
  return parts.join("\n");
}

function firstText(result: { content?: readonly unknown[] }): string {
  const item = result.content?.[0] as
    | { type?: string; text?: string }
    | undefined;
  return item && typeof item.text === "string" ? item.text : "";
}

function errorResult(tool: string, message: string) {
  return {
    content: [
      { type: "text" as const, text: `${tool} unavailable: ${message}` },
    ],
    details: { error: message },
  };
}

function isDataUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith("data:");
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

export function createWebSearchTool(deps: WebSearchDeps = {}) {
  return defineTool({
    name: "web_search",
    label: "web_search",
    description:
      "Search the web for current docs and results. Returns title, url, and snippet.",
    exposure: "codemode",
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    renderCall(args, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const query = typeof args?.query === "string" ? args.query : "";
      let line = `${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", JSON.stringify(query))}`;
      if (args?.max_results !== undefined) {
        line += ` ${theme.fg("muted", `(limit ${args.max_results})`)}`;
      }
      text.setText(line);
      return text;
    },
    renderResult(result, options, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const details = result.details as
        | {
            query?: string;
            results?: WebSearchResultItem[];
            truncated?: boolean;
            error?: string;
          }
        | undefined;

      const textOutput = firstText(result);
      if (details?.error || textOutput.includes("unavailable:")) {
        text.setText(
          theme.fg("error", textOutput !== "" ? textOutput : "Search failed"),
        );
        return text;
      }

      const items = details?.results ?? [];
      if (items.length === 0) {
        text.setText(theme.fg("muted", "No search results."));
        return text;
      }

      if (!options.expanded) {
        const domains = Array.from(
          new Set(items.map((it) => extractDomain(it.url))),
        );
        const domainStr =
          domains.slice(0, 3).join(", ") + (domains.length > 3 ? ", ..." : "");
        let hint = "to expand";
        try {
          hint = keyHint("app.tools.expand", "to expand");
        } catch {
          hint = "[Space] to expand";
        }
        const summary = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", "Found")} ${theme.fg("accent", `${items.length} results`)} ${theme.fg("muted", `(${domainStr})`)} ${theme.fg("muted", `(${hint})`)}`;
        text.setText(summary);
        return text;
      }

      const lines: string[] = [
        `${theme.fg("success", "✓")} ${theme.fg("toolTitle", "Found")} ${theme.fg("accent", `${items.length} results:`)}`,
      ];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        lines.push(
          `${theme.fg("dim", `${i + 1}.`)} ${theme.fg("accent", theme.bold(item.title))}`,
        );
        lines.push(`   ${theme.fg("muted", item.url)}`);
        if (item.snippet) {
          lines.push(`   ${theme.fg("toolOutput", item.snippet.trim())}`);
        }
      }

      text.setText(lines.join("\n"));
      return text;
    },
    async execute(
      _toolCallId,
      params: { query: string; max_results?: number },
    ) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (query === "") return errorResult("web_search", "query is required");
      if (
        params.max_results !== undefined &&
        (!Number.isInteger(params.max_results) || params.max_results < 1)
      ) {
        return errorResult(
          "web_search",
          "max_results must be a positive integer",
        );
      }
      const limit = Math.min(
        params.max_results ?? SEARCH_DEFAULT_RESULTS,
        SEARCH_MAX_RESULTS,
      );
      try {
        const results = await (deps.search ?? defaultSearch)({
          query,
          maxResults: limit,
        });
        const capped = results.slice(0, limit).map(normalizeSearch);
        const text = formatSearchMarkdown(
          query,
          capped,
          results.length > limit,
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {
            query,
            results: capped,
            truncated: results.length > limit,
          },
        };
      } catch (error) {
        return errorResult(
          "web_search",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}

export function createWebFetchTool(deps: WebFetchDeps = {}) {
  return defineTool({
    name: "web_fetch",
    label: "web_fetch",
    description:
      "Fetch a web page and return readable text, links, and media metadata.",
    exposure: "codemode",
    parameters: Type.Object({
      url: Type.String({ minLength: 1 }),
      max_chars: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    renderCall(args, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const url = typeof args?.url === "string" ? args.url : "";
      let line = `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", url)}`;
      if (args?.max_chars !== undefined) {
        line += ` ${theme.fg("muted", `(max ${args.max_chars} chars)`)}`;
      }
      text.setText(line);
      return text;
    },
    renderResult(result, options, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const details = result.details as
        | {
            url?: string;
            finalUrl?: string;
            content?: string;
            truncated?: boolean;
            error?: string;
          }
        | undefined;

      const textOutput = firstText(result);
      if (details?.error || textOutput.includes("unavailable:")) {
        text.setText(
          theme.fg("error", textOutput !== "" ? textOutput : "Fetch failed"),
        );
        return text;
      }

      const content = details?.content ?? textOutput;
      const url = details?.finalUrl || details?.url || "web page";
      const rawLines = content
        .split("\n")
        .filter((l: string) => l.trim().length > 0);

      const header = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", "Fetched")} ${theme.fg("accent", url)} ${theme.fg("muted", `(${content.length} chars)`)}`;
      const resLines: string[] = [header];

      if (
        details?.finalUrl &&
        details.url &&
        details.finalUrl !== details.url
      ) {
        resLines.push(theme.fg("dim", `  ↳ Redirected from ${details.url}`));
      }

      const maxPreviewLines = options.expanded ? rawLines.length : 8;
      const displayLines = rawLines.slice(0, maxPreviewLines);
      const remaining = rawLines.length - maxPreviewLines;

      for (const l of displayLines) {
        const snippet =
          !options.expanded && l.length > 120 ? `${l.slice(0, 117)}...` : l;
        resLines.push(`  ${theme.fg("toolOutput", snippet)}`);
      }

      if (remaining > 0) {
        resLines.push(`  ${expandHint(theme, remaining, "lines")}`);
      }

      text.setText(resLines.join("\n"));
      return text;
    },
    async execute(_toolCallId, params: { url: string; max_chars?: number }) {
      const url = typeof params.url === "string" ? params.url.trim() : "";
      if (url === "") return errorResult("web_fetch", "url is required");
      if (
        params.max_chars !== undefined &&
        (!Number.isInteger(params.max_chars) || params.max_chars < 1)
      ) {
        return errorResult("web_fetch", "max_chars must be a positive integer");
      }
      const limit = Math.min(
        params.max_chars ?? FETCH_DEFAULT_CHARS,
        FETCH_MAX_CHARS,
      );
      try {
        const result = await (deps.fetch ?? defaultFetch)({ url });
        const content = result.content.slice(0, limit);
        const safeLinks = result.links.filter((link) => !isDataUrl(link.url));
        const safeMedia = result.media.filter((item) => !isDataUrl(item.url));
        const links = safeLinks.slice(0, FETCH_MAX_LINKS);
        const media = safeMedia.slice(0, FETCH_MAX_MEDIA);
        const isTruncated =
          result.truncated ||
          result.content.length > limit ||
          safeLinks.length > FETCH_MAX_LINKS ||
          safeMedia.length > FETCH_MAX_MEDIA;
        const text = formatFetchMarkdown(
          url,
          result.finalUrl,
          content,
          links,
          isTruncated,
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {
            url: result.url,
            finalUrl: result.finalUrl,
            contentType: result.contentType,
            content,
            links,
            media,
            truncated: isTruncated,
          },
        };
      } catch (error) {
        return errorResult(
          "web_fetch",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}
