import { extractHtml } from "./extract.js";
import { createExaAdapter } from "./providers/exa.js";
import { providerSignal } from "./providers/selection.js";
import { createTavilyAdapter } from "./providers/tavily.js";
import type {
  FetchRequest,
  NormalizedFetchResult,
  ProviderAdapter,
} from "./providers/types.js";

export interface FetchOptions {
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  providers?: readonly ProviderAdapter[];
}

function ensureResult(
  result: NormalizedFetchResult,
  requestUrl: string,
): NormalizedFetchResult {
  return {
    url: result.url || requestUrl,
    finalUrl: result.finalUrl || result.url || requestUrl,
    provider: result.provider,
    contentType: result.contentType || "",
    content: result.content || "",
    links: Array.isArray(result.links) ? result.links : [],
    media: Array.isArray(result.media) ? result.media : [],
    truncated: Boolean(result.truncated),
  };
}

export async function rawFetch(
  url: string,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<NormalizedFetchResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(url, {
    signal: options.signal,
    redirect: "follow",
  });
  const finalUrl = response.url || url;
  const contentType = response.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim();

  if (!response.ok) {
    throw new Error(
      `raw fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const lower = mediaType.toLowerCase();
  if (lower.includes("html")) {
    const page = extractHtml(await response.text(), finalUrl);
    return {
      url,
      finalUrl,
      provider: "raw",
      contentType: mediaType || "text/html",
      content: page.content,
      links: page.links,
      media: page.media,
      truncated: false,
    };
  }

  if (
    lower === "" ||
    lower.startsWith("text/") ||
    lower.includes("json") ||
    lower.includes("xml")
  ) {
    return {
      url,
      finalUrl,
      provider: "raw",
      contentType: mediaType || "text/plain",
      content: await response.text(),
      links: [],
      media: [],
      truncated: false,
    };
  }

  await response.body?.cancel();
  return {
    url,
    finalUrl,
    provider: "raw",
    contentType: mediaType,
    content: "",
    links: [],
    media: [],
    truncated: false,
  };
}

export async function fetchUrl(
  url: string,
  options: FetchOptions = {},
): Promise<NormalizedFetchResult> {
  const signal = providerSignal(options.signal, options.timeoutMs);
  const fetchImpl = options.fetchImpl;
  const providers = options.providers ?? [
    createExaAdapter({ apiKey: options.apiKey, fetchImpl }),
    createTavilyAdapter({ apiKey: options.apiKey, fetchImpl }),
  ];

  for (const provider of providers) {
    if (signal.aborted) {
      throw new DOMException("fetch aborted", "AbortError");
    }
    if (provider.fetch === undefined) continue;
    if (provider.capabilities.fetch === false) continue;
    try {
      const request: FetchRequest = { url, apiKey: options.apiKey, signal };
      const result = ensureResult(await provider.fetch(request), url);
      if (signal.aborted) {
        throw new DOMException("fetch aborted", "AbortError");
      }
      if (result.content.trim() !== "") return result;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  return rawFetch(url, { fetchImpl, signal });
}
