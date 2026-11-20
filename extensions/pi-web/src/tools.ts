import {
  type ExtensionAPI,
  type ExtensionContext,
  defineTool,
  getAgentDir,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Image,
  Text,
  getCapabilities,
  hyperlink,
} from "@earendil-works/pi-tui";
import {
  errorMessage,
  sanitizeTerminalText,
  toolErrorResult,
  toolTextResult,
} from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { appendSessionEntry } from "@hollowheap/core/state";
import { StyledMarkdown } from "@hollowheap/ui/markdown";
import { formatExpandHint } from "@hollowheap/ui/tool-output";
import { Type } from "typebox";
import {
  type MediaPreview,
  fetchMediaPreview,
  getMediaPreview,
  setMediaPreview,
} from "./media.js";
import {
  providerSignal,
  resolveFetchOrder,
  resolveSearchOrder,
  withProviderFallback,
} from "./providers/selection.js";
import type {
  FetchProvider,
  FetchRequest,
  NormalizedFetchResult,
  NormalizedSearchResult,
  ProviderAdapter,
  ProviderId,
  SearchRequest,
} from "./providers/types.js";
import { loadWebConfig } from "./settings.js";
import { isSafeUrl } from "./url.js";

export const SEARCH_DEFAULT_RESULTS = 5;
export const SEARCH_MAX_RESULTS = 10;
export const FETCH_DEFAULT_CHARS = 20_000;
export const FETCH_MAX_CHARS = 100_000;
export const FETCH_MAX_LINKS = 50;
export const FETCH_MAX_MEDIA = 20;
const FETCH_CACHE_TTL_MS = 5 * 60_000;
const FETCH_RATE_LIMIT_MS = 1_000;

export const WEB_HISTORY_TYPE = "hollowheap.web.history";

export interface WebSessionState {
  urls: string[];
  searchCount: number;
  fetchCount: number;
  updatedAt: number;
}

const webStates = new WeakMap<object, WebSessionState>();
const fallbackWebState: WebSessionState = {
  urls: [],
  searchCount: 0,
  fetchCount: 0,
  updatedAt: 0,
};
let lastActiveWebState = fallbackWebState;

export function getWebSessionState(owner?: unknown): WebSessionState {
  if (typeof owner === "object" && owner !== null) {
    let state = webStates.get(owner);
    if (state === undefined) {
      state = { urls: [], searchCount: 0, fetchCount: 0, updatedAt: 0 };
      webStates.set(owner, state);
    }
    lastActiveWebState = state;
    return state;
  }
  return fallbackWebState;
}

export function getLastWebLinks(owner?: unknown): readonly string[] {
  if (typeof owner === "object" && owner !== null) {
    return getWebSessionState(owner).urls;
  }
  return lastActiveWebState.urls.length > 0
    ? lastActiveWebState.urls
    : fallbackWebState.urls;
}

export function rememberWebLinks(
  links: readonly { url: string }[],
  owner?: unknown,
): void {
  const state = getWebSessionState(owner);
  const seen = new Set<string>();
  const merged = [...links.map((link) => link.url), ...state.urls];
  state.urls = merged
    .filter((url) => {
      if (seen.has(url) || !isSafeUrl(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 20);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function linkedUrl(value: string): string {
  return isHttpUrl(value) ? hyperlink(value, value) : value;
}

function markdownUrl(value: string): string {
  return isHttpUrl(value) ? `[${value}](${value})` : value;
}

export interface WebSearchDeps {
  search?: (request: SearchRequest) => Promise<NormalizedSearchResult[]>;
  pi?: ExtensionAPI;
}

export interface WebFetchDeps {
  fetch?: (request: FetchRequest) => Promise<NormalizedFetchResult>;
  previewMedia?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<MediaPreview | undefined>;
  pi?: ExtensionAPI;
}

async function adapterFor(provider: ProviderId): Promise<ProviderAdapter> {
  if (provider === "exa") {
    const { createExaAdapter } = await import("./providers/exa.js");
    return createExaAdapter();
  }
  if (provider === "tavily") {
    const { createTavilyAdapter } = await import("./providers/tavily.js");
    return createTavilyAdapter();
  }
  const { createFirecrawlAdapter } = await import("./providers/firecrawl.js");
  return createFirecrawlAdapter();
}

async function fetchAdapterFor(
  provider: FetchProvider,
): Promise<ProviderAdapter> {
  if (provider === "exa") {
    const { createExaAdapter } = await import("./providers/exa.js");
    return createExaAdapter();
  }
  const { createTavilyAdapter } = await import("./providers/tavily.js");
  return createTavilyAdapter();
}

async function defaultSearch(
  request: SearchRequest,
): Promise<NormalizedSearchResult[]> {
  const config = loadWebConfig(getAgentDir());
  const order = resolveSearchOrder(config.searchOrder);
  const signal = providerSignal(request.signal);
  if (order.length === 0) {
    const { searchKeyless } = await import("./keyless.js");
    return searchKeyless({ ...request, signal });
  }
  try {
    return await withProviderFallback(
      order,
      async (provider) =>
        (await adapterFor(provider)).search({ ...request, signal }),
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    const { searchKeyless } = await import("./keyless.js");
    return searchKeyless({ ...request, signal });
  }
}

async function defaultFetch(
  request: FetchRequest,
): Promise<NormalizedFetchResult> {
  const config = loadWebConfig(getAgentDir());
  const order = resolveFetchOrder(config.fetchOrder);
  const providers = await Promise.all(
    order
      .filter((provider) => provider !== "raw")
      .map((provider) => fetchAdapterFor(provider)),
  );
  const { fetchUrl } = await import("./fetch.js");
  return fetchUrl(request.url, {
    apiKey: request.apiKey,
    signal: request.signal,
    providers,
    cacheTtlMs: FETCH_CACHE_TTL_MS,
    rateLimitMs: FETCH_RATE_LIMIT_MS,
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
    lines.push(`${i + 1}. [${sanitizeTerminalText(r.title)}](${r.url})`);
    if (r.snippet) {
      lines.push(`   ${sanitizeTerminalText(r.snippet).trim()}`);
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
  media: readonly {
    url: string;
    kind: string;
    alt?: string;
    mimeType?: string;
  }[] = [],
): string {
  const parts: string[] = [];
  if (finalUrl && finalUrl !== url) {
    parts.push(`*Redirected to: ${markdownUrl(finalUrl)}*\n`);
  }
  parts.push(sanitizeTerminalText(content).trim());
  if (isTruncated) {
    parts.push(`\n\n[Content truncated to ${content.length} characters]`);
  }
  if (links.length > 0) {
    parts.push("\n\n## Page Links");
    for (const link of links) {
      const label = sanitizeTerminalText(link.text || link.title || link.url);
      parts.push(`- [${label}](${link.url})`);
    }
  }
  if (media.length > 0) {
    parts.push("\n\n## Media");
    for (const item of media) {
      const label = sanitizeTerminalText(item.alt || `${item.kind} media`);
      parts.push(`- [${label}](${item.url})`);
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
  return toolErrorResult(`${tool} unavailable`, message);
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

export function createWebSearchTool(
  deps: WebSearchDeps = {},
  pi?: ExtensionAPI,
) {
  return defineTool({
    name: "web_search",
    label: "web_search",
    description:
      "Search the web for current docs and results. Returns title, url, and snippet.",
    exposure: "codemode",
    promptGuidelines: [
      'web_search is codemode-only: call it as tools.web_search("query") or tools.web_search({ query, max_results }) inside a codemode script.',
    ],
    parameters: Type.Union([
      Type.String({ minLength: 1, description: "Search query shorthand." }),
      Type.Object({
        query: Type.String({ minLength: 1 }),
        max_results: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
    ]),
    renderCall(args, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const query =
        typeof args === "string"
          ? args
          : typeof args?.query === "string"
            ? args.query
            : "";
      const maxResults =
        typeof args === "object" && args !== null
          ? args.max_results
          : undefined;
      let line = `${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", JSON.stringify(query))}`;
      if (maxResults !== undefined) {
        line += ` ${theme.fg("muted", `(limit ${maxResults})`)}`;
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
            image?: { data: string; mimeType: string };
            error?: string;
          }
        | undefined;

      const textOutput = firstText(result);
      if (details?.error) {
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

      return new StyledMarkdown(
        formatSearchMarkdown(
          details?.query ?? "",
          items,
          details?.truncated ?? false,
        ),
        theme,
      );
    },
    async execute(
      _toolCallId,
      params: string | { query: string; max_results?: number },
      signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ) {
      const normalized =
        typeof params === "string" ? { query: params } : params;
      const query =
        typeof normalized.query === "string" ? normalized.query.trim() : "";
      if (query === "") return errorResult("web_search", "query is required");
      if (
        normalized.max_results !== undefined &&
        (!Number.isInteger(normalized.max_results) ||
          normalized.max_results < 1)
      ) {
        return errorResult(
          "web_search",
          "max_results must be a positive integer",
        );
      }
      const limit = Math.min(
        normalized.max_results ?? SEARCH_DEFAULT_RESULTS,
        SEARCH_MAX_RESULTS,
      );
      try {
        const results = await (deps.search ?? defaultSearch)({
          query,
          maxResults: limit,
          signal,
        });
        const safeResults = results.filter((item) => isSafeUrl(item.url));
        const capped = safeResults.slice(0, limit).map(normalizeSearch);
        const owner = ctx?.sessionManager;
        rememberWebLinks(capped, owner);
        const state = getWebSessionState(owner);
        state.searchCount += 1;
        state.updatedAt = Date.now();
        const piApi = deps.pi ?? pi;
        appendSessionEntry(piApi, owner, WEB_HISTORY_TYPE, {
          urls: state.urls,
          searchCount: state.searchCount,
          fetchCount: state.fetchCount,
          updatedAt: state.updatedAt,
        });
        if (owner) {
          updateSessionSnapshot(owner, "web", {
            searchCount: state.searchCount,
            fetchCount: state.fetchCount,
            recentUrls: state.urls,
            updatedAt: state.updatedAt,
          });
        }
        const text = formatSearchMarkdown(
          query,
          capped,
          safeResults.length > limit,
        );
        return toolTextResult(text, {
          query,
          results: capped,
          truncated: safeResults.length > limit,
        });
      } catch (error) {
        return errorResult("web_search", errorMessage(error));
      }
    },
  });
}

export function createWebFetchTool(deps: WebFetchDeps = {}, pi?: ExtensionAPI) {
  return defineTool({
    name: "web_fetch",
    label: "web_fetch",
    description:
      "Fetch a web page and return readable text, links, and media metadata.",
    exposure: "codemode",
    promptGuidelines: [
      'web_fetch is codemode-only: call it as tools.web_fetch("https://...") or tools.web_fetch({ url, max_chars }) inside a codemode script.',
    ],
    parameters: Type.Union([
      Type.String({ minLength: 1, description: "URL to fetch shorthand." }),
      Type.Object({
        url: Type.String({ minLength: 1 }),
        max_chars: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
    ]),
    renderCall(args, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const rawUrl =
        typeof args === "string"
          ? args
          : typeof args?.url === "string"
            ? args.url
            : "";
      const url = sanitizeTerminalText(rawUrl);
      const maxChars =
        typeof args === "object" && args !== null ? args.max_chars : undefined;
      let line = `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", url)}`;
      if (maxChars !== undefined) {
        line += ` ${theme.fg("muted", `(max ${maxChars} chars)`)}`;
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
            links?: { title?: string; text?: string; url: string }[];
            media?: {
              url: string;
              kind: string;
              alt?: string;
              mimeType?: string;
            }[];
            truncated?: boolean;
            image?: { data: string; mimeType: string };
            error?: string;
          }
        | undefined;

      const textOutput = firstText(result);
      if (details?.error) {
        text.setText(
          theme.fg("error", textOutput !== "" ? textOutput : "Fetch failed"),
        );
        return text;
      }

      const content = sanitizeTerminalText(details?.content ?? textOutput);
      const safeDetailsUrl =
        details?.url !== undefined
          ? sanitizeTerminalText(details.url)
          : undefined;
      const safeFinalUrl =
        details?.finalUrl !== undefined
          ? sanitizeTerminalText(details.finalUrl)
          : undefined;
      const url = safeFinalUrl || safeDetailsUrl || "web page";
      if (options.expanded) {
        const markdown = new StyledMarkdown(
          `**Fetched** ${markdownUrl(url)}\n\n${formatFetchMarkdown(
            safeDetailsUrl ?? url,
            safeFinalUrl ?? url,
            content,
            details?.links ?? [],
            details?.truncated ?? false,
            details?.media ?? [],
          )}`,
          theme,
        );
        const previews = (details?.media ?? [])
          .filter((item) => item.kind === "image")
          .map((item) => getMediaPreview(item.url))
          .filter((preview): preview is MediaPreview => preview !== undefined);
        const directImage = details?.image;
        if (previews.length === 0 && directImage === undefined) return markdown;
        const container = new Container();
        container.addChild(markdown);
        if (directImage !== undefined) {
          container.addChild(
            new Image(
              directImage.data,
              directImage.mimeType,
              { fallbackColor: (text) => theme.fg("muted", text) },
              { maxWidthCells: 60 },
            ),
          );
        }
        for (const preview of previews) {
          container.addChild(
            new Image(
              preview.data,
              preview.mimeType,
              { fallbackColor: (text) => theme.fg("muted", text) },
              { maxWidthCells: 60 },
            ),
          );
        }
        return container;
      }

      const rawLines = content
        .split("\n")
        .filter((l: string) => l.trim().length > 0);
      const header = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", "Fetched")} ${theme.fg("accent", linkedUrl(url))} ${theme.fg("muted", `(${content.length} chars)`)}`;
      const resLines: string[] = [header];

      if (safeFinalUrl && safeDetailsUrl && safeFinalUrl !== safeDetailsUrl) {
        resLines.push(
          theme.fg("dim", `  ↳ Redirected from ${linkedUrl(safeDetailsUrl)}`),
        );
      }

      const displayLines = rawLines.slice(0, 8);
      const remaining = rawLines.length - displayLines.length;

      for (const l of displayLines) {
        const snippet = l.length > 120 ? `${l.slice(0, 117)}...` : l;
        resLines.push(
          `  ${theme.fg("toolOutput", sanitizeTerminalText(snippet))}`,
        );
      }

      if (remaining > 0) {
        resLines.push(`  ${formatExpandHint(remaining, "lines", theme)}`);
      }

      text.setText(resLines.join("\n"));
      return text;
    },
    async execute(
      _toolCallId,
      params: string | { url: string; max_chars?: number },
      signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ) {
      const normalized = typeof params === "string" ? { url: params } : params;
      const url =
        typeof normalized.url === "string" ? normalized.url.trim() : "";
      if (url === "") return errorResult("web_fetch", "url is required");
      if (
        normalized.max_chars !== undefined &&
        (!Number.isInteger(normalized.max_chars) || normalized.max_chars < 1)
      ) {
        return errorResult("web_fetch", "max_chars must be a positive integer");
      }
      const limit = Math.min(
        normalized.max_chars ?? FETCH_DEFAULT_CHARS,
        FETCH_MAX_CHARS,
      );
      try {
        const result = await (deps.fetch ?? defaultFetch)({ url, signal });
        const content = result.content.slice(0, limit);
        const safeLinks = result.links.filter((link) => !isDataUrl(link.url));
        const safeMedia = result.media.filter((item) => !isDataUrl(item.url));
        const links = safeLinks.slice(0, FETCH_MAX_LINKS);
        const owner = ctx?.sessionManager;
        rememberWebLinks(isHttpUrl(url) ? [{ url }, ...links] : links, owner);
        const state = getWebSessionState(owner);
        state.fetchCount += 1;
        state.updatedAt = Date.now();
        const piApi = deps.pi ?? pi;
        appendSessionEntry(piApi, owner, WEB_HISTORY_TYPE, {
          urls: state.urls,
          searchCount: state.searchCount,
          fetchCount: state.fetchCount,
          updatedAt: state.updatedAt,
        });
        if (owner) {
          updateSessionSnapshot(owner, "web", {
            searchCount: state.searchCount,
            fetchCount: state.fetchCount,
            recentUrls: state.urls,
            updatedAt: state.updatedAt,
          });
        }
        const media = safeMedia.slice(0, FETCH_MAX_MEDIA);
        const isTruncated =
          result.truncated ||
          result.content.length > limit ||
          safeLinks.length > FETCH_MAX_LINKS ||
          safeMedia.length > FETCH_MAX_MEDIA;
        if (getCapabilities().images && !signal?.aborted) {
          const preview = deps.previewMedia ?? fetchMediaPreview;
          const previewSignal = providerSignal(signal, 15_000);
          await Promise.all(
            media
              .filter(
                (item) => item.kind === "image" && !getMediaPreview(item.url),
              )
              .slice(0, 2)
              .map(async (item) => {
                try {
                  const result = await preview(item.url, previewSignal);
                  if (result !== undefined) {
                    setMediaPreview(item.url, result);
                  }
                } catch {
                  // Image previews are optional; keep the link fallback.
                }
              }),
          );
        }
        const text = formatFetchMarkdown(
          url,
          result.finalUrl,
          content,
          links,
          isTruncated,
          media,
        );
        const details = {
          url: result.url,
          finalUrl: result.finalUrl,
          contentType: result.contentType,
          content,
          links,
          media,
          truncated: isTruncated,
          ...(result.image === undefined ? {} : { image: result.image }),
        };
        if (result.image === undefined) {
          return toolTextResult(text, details);
        }
        const contentBlocks: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          { type: "text", text },
          {
            type: "image",
            data: result.image.data,
            mimeType: result.image.mimeType,
          },
        ];
        return {
          content: contentBlocks,
          details,
        };
      } catch (error) {
        return errorResult("web_fetch", errorMessage(error));
      }
    },
  });
}
