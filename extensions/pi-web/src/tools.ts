import { Type } from "@earendil-works/pi-ai";
import {
  type Theme,
  defineTool,
  getAgentDir,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Image,
  Markdown,
  type MarkdownTheme,
  Text,
  getCapabilities,
  hyperlink,
} from "@earendil-works/pi-tui";
import { loadWebConfig } from "./config.js";
import { fetchUrl } from "./fetch.js";
import { searchKeyless } from "./keyless.js";
import {
  type MediaPreview,
  fetchMediaPreview,
  getMediaPreview,
  setMediaPreview,
} from "./media.js";
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
const FETCH_CACHE_TTL_MS = 5 * 60_000;
const FETCH_RATE_LIMIT_MS = 1_000;
let lastWebLinks: string[] = [];

export function getLastWebLinks(): readonly string[] {
  return lastWebLinks;
}

export function rememberWebLinks(links: readonly { url: string }[]): void {
  const seen = new Set<string>();
  lastWebLinks = links
    .map((link) => link.url)
    .filter((url) => {
      if (!/^https?:\/\//i.test(url) || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 20);
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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function linkedUrl(value: string): string {
  return isHttpUrl(value) ? hyperlink(value, value) : value;
}

function markdownUrl(value: string): string {
  return isHttpUrl(value) ? `[${value}](${value})` : value;
}

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
  previewMedia?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<MediaPreview | undefined>;
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
  if (order.length === 0) {
    return searchKeyless({ ...request, signal });
  }
  try {
    return await withProviderFallback(
      order,
      (provider) => adapterFor(provider).search({ ...request, signal }),
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    return searchKeyless({ ...request, signal });
  }
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
  if (media.length > 0) {
    parts.push("\n\n## Media");
    for (const item of media) {
      const label = item.alt || `${item.kind} media`;
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
            image?: { data: string; mimeType: string };
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

      return new Markdown(
        formatSearchMarkdown(
          details?.query ?? "",
          items,
          details?.truncated ?? false,
        ),
        0,
        0,
        markdownTheme(theme),
      );
    },
    async execute(
      _toolCallId,
      params: { query: string; max_results?: number },
      signal?: AbortSignal,
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
          signal,
        });
        const capped = results.slice(0, limit).map(normalizeSearch);
        rememberWebLinks(capped);
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
      if (details?.error || textOutput.includes("unavailable:")) {
        text.setText(
          theme.fg("error", textOutput !== "" ? textOutput : "Fetch failed"),
        );
        return text;
      }

      const content = details?.content ?? textOutput;
      const url = details?.finalUrl || details?.url || "web page";
      if (options.expanded) {
        const markdown = new Markdown(
          `**Fetched** ${markdownUrl(url)}\n\n${formatFetchMarkdown(
            details?.url ?? url,
            details?.finalUrl ?? url,
            content,
            details?.links ?? [],
            details?.truncated ?? false,
            details?.media ?? [],
          )}`,
          0,
          0,
          markdownTheme(theme),
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

      if (
        details?.finalUrl &&
        details.url &&
        details.finalUrl !== details.url
      ) {
        resLines.push(
          theme.fg("dim", `  ↳ Redirected from ${linkedUrl(details.url)}`),
        );
      }

      const displayLines = rawLines.slice(0, 8);
      const remaining = rawLines.length - displayLines.length;

      for (const l of displayLines) {
        const snippet = l.length > 120 ? `${l.slice(0, 117)}...` : l;
        resLines.push(`  ${theme.fg("toolOutput", snippet)}`);
      }

      if (remaining > 0) {
        resLines.push(`  ${expandHint(theme, remaining, "lines")}`);
      }

      text.setText(resLines.join("\n"));
      return text;
    },
    async execute(
      _toolCallId,
      params: { url: string; max_chars?: number },
      signal?: AbortSignal,
    ) {
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
        const result = await (deps.fetch ?? defaultFetch)({ url, signal });
        const content = result.content.slice(0, limit);
        const safeLinks = result.links.filter((link) => !isDataUrl(link.url));
        const safeMedia = result.media.filter((item) => !isDataUrl(item.url));
        const links = safeLinks.slice(0, FETCH_MAX_LINKS);
        rememberWebLinks(links);
        const media = safeMedia.slice(0, FETCH_MAX_MEDIA);
        const isTruncated =
          result.truncated ||
          result.content.length > limit ||
          safeLinks.length > FETCH_MAX_LINKS ||
          safeMedia.length > FETCH_MAX_MEDIA;
        if (getCapabilities().images && !signal?.aborted) {
          const preview = deps.previewMedia ?? fetchMediaPreview;
          await Promise.all(
            media
              .filter(
                (item) => item.kind === "image" && !getMediaPreview(item.url),
              )
              .slice(0, 2)
              .map(async (item) => {
                try {
                  const result = await preview(item.url, signal);
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
        const contentBlocks: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text }];
        if (result.image !== undefined) {
          contentBlocks.push({
            type: "image",
            data: result.image.data,
            mimeType: result.image.mimeType,
          });
        }
        return {
          content: contentBlocks,
          details: {
            url: result.url,
            finalUrl: result.finalUrl,
            contentType: result.contentType,
            content,
            links,
            media,
            truncated: isTruncated,
            ...(result.image === undefined ? {} : { image: result.image }),
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
