import { extractHtml } from "./extract.js";
import { createExaAdapter } from "./providers/exa.js";
import { providerSignal } from "./providers/selection.js";
import { createTavilyAdapter } from "./providers/tavily.js";
import type {
  FetchRequest,
  NormalizedFetchResult,
  ProviderAdapter,
} from "./providers/types.js";
import { MAX_REDIRECTS, assertSafeUrl } from "./url.js";

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
  assertSafeUrl(url);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const signal = options.signal;
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    const response = await fetchImpl(currentUrl, {
      signal,
      redirect: "manual",
    });

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      const location = response.headers.get("location");
      if (!location) {
        await response.body?.cancel?.();
        throw new Error("redirect missing Location header");
      }
      const nextUrl = new URL(location, currentUrl).href;
      assertSafeUrl(nextUrl);
      await response.body?.cancel?.();
      if (redirects >= MAX_REDIRECTS) {
        throw new Error("too many redirects");
      }
      redirects += 1;
      currentUrl = nextUrl;
      continue;
    }

    const finalUrl = response.url || currentUrl;
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
}

export async function fetchUrl(
  url: string,
  options: FetchOptions = {},
): Promise<NormalizedFetchResult> {
  assertSafeUrl(url);
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
