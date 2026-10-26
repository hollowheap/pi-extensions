import { Type } from "@earendil-works/pi-ai";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
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

function normalizeSearch(item: NormalizedSearchResult): NormalizedSearchResult {
  return {
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    provider: item.provider,
  };
}

function errorResult(tool: string, message: string) {
  return {
    content: [
      { type: "text" as const, text: `${tool} unavailable: ${message}` },
    ],
    details: { error: message },
  };
}

function textResult(details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

export function createWebSearchTool(deps: WebSearchDeps = {}) {
  return defineTool({
    name: "web_search",
    label: "web_search",
    description:
      "Search the web for current docs and results. Returns title, url, snippet, and provider.",
    exposure: "direct",
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
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
        return textResult({
          results: capped,
          truncated: results.length > limit,
        });
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
    exposure: "direct",
    parameters: Type.Object({
      url: Type.String({ minLength: 1 }),
      max_chars: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
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
        const links = result.links.slice(0, FETCH_MAX_LINKS);
        const media = result.media.slice(0, FETCH_MAX_MEDIA);
        return textResult({
          url: result.url,
          finalUrl: result.finalUrl,
          provider: result.provider,
          contentType: result.contentType,
          content,
          links,
          media,
          truncated:
            result.truncated ||
            result.content.length > limit ||
            result.links.length > FETCH_MAX_LINKS ||
            result.media.length > FETCH_MAX_MEDIA,
        });
      } catch (error) {
        return errorResult(
          "web_fetch",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}
