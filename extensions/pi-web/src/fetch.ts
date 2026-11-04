import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { extractHtml } from "./extract.js";
import { MAX_PDF_BYTES, extractPdfText } from "./pdf.js";
import { createExaAdapter } from "./providers/exa.js";
import { providerSignal } from "./providers/selection.js";
import { createTavilyAdapter } from "./providers/tavily.js";
import type {
  FetchRequest,
  NormalizedFetchResult,
  ProviderAdapter,
} from "./providers/types.js";
import {
  type HostResolver,
  MAX_REDIRECTS,
  assertSafeResolvedUrl,
  assertSafeUrl,
} from "./url.js";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface FetchOptions {
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  providers?: readonly ProviderAdapter[];
  cacheTtlMs?: number;
  acceptType?: "json" | "html" | "text" | "auto";
  rateLimitMs?: number;
  resolveHost?: HostResolver;
}

const MAX_CACHE_ENTRIES = 32;
const fetchCache = new Map<
  string,
  { result: NormalizedFetchResult; expiresAt: number }
>();

let lastRequestTime = 0;
let rateLimitChain: Promise<void> = Promise.resolve();

async function rateLimit(ms: number): Promise<void> {
  const previous = rateLimitChain;
  let release = (): void => {};
  rateLimitChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const now = Date.now();
    const wait = Math.max(0, lastRequestTime + ms - now);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestTime = Date.now();
  } finally {
    release();
  }
}

function cacheKeyFor(url: string, options: FetchOptions): string {
  const apiKey = options.apiKey
    ? createHash("sha256").update(options.apiKey).digest("hex").slice(0, 16)
    : "none";
  const providers =
    options.providers?.map((provider) => provider.id).join(",") ?? "default";
  const fetchImpl = options.fetchImpl === undefined ? "default" : "custom";
  return `${url}\0${options.acceptType ?? "auto"}\0${apiKey}\0${providers}\0${fetchImpl}`;
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

async function readBoundedText(response: Response): Promise<{
  text: string;
  truncated: boolean;
}> {
  const body = await readBoundedBytes(response, MAX_RESPONSE_BYTES);
  return {
    text: new TextDecoder().decode(body.bytes),
    truncated: body.truncated,
  };
}

export async function rawFetch(
  url: string,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    acceptType?: "json" | "html" | "text" | "auto";
    resolveHost?: HostResolver;
  } = {},
): Promise<NormalizedFetchResult> {
  assertSafeUrl(url);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const signal = options.signal;
  const acceptType = options.acceptType ?? "auto";
  const acceptHeader =
    acceptType === "json"
      ? "application/json"
      : acceptType === "html"
        ? "text/html"
        : acceptType === "text"
          ? "text/plain"
          : "text/html,application/json,text/plain;q=0.9,*/*;q=0.8";
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    await assertSafeResolvedUrl(currentUrl, options.resolveHost);
    const response = await fetchImpl(currentUrl, {
      signal,
      redirect: "manual",
      headers: { Accept: acceptHeader },
    });

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      try {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("redirect missing Location header");
        }
        const nextUrl = new URL(location, currentUrl).href;
        assertSafeUrl(nextUrl);
        if (redirects >= MAX_REDIRECTS) {
          throw new Error("too many redirects");
        }
        redirects += 1;
        currentUrl = nextUrl;
      } finally {
        await response.body?.cancel?.();
      }
      continue;
    }

    const finalUrl = response.url || currentUrl;
    const contentType = response.headers.get("content-type") ?? "";
    const mediaType = contentType.split(";")[0].trim();

    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error(
        `raw fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    const lower = mediaType.toLowerCase();
    if (lower === "application/pdf") {
      const body = await readBoundedBytes(response, MAX_PDF_BYTES);
      if (body.truncated) {
        return {
          url,
          finalUrl,
          provider: "raw",
          contentType: mediaType,
          content: "PDF exceeds the 5 MB extraction limit.",
          links: [],
          media: [],
          truncated: true,
        };
      }
      try {
        const pdf = await extractPdfText(body.bytes, signal);
        return {
          url,
          finalUrl,
          provider: "raw",
          contentType: mediaType,
          content: pdf.text,
          links: [],
          media: [],
          truncated: pdf.truncated,
        };
      } catch (error) {
        return {
          url,
          finalUrl,
          provider: "raw",
          contentType: mediaType,
          content: `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
          links: [],
          media: [],
          truncated: false,
        };
      }
    }

    if (IMAGE_TYPES.has(lower)) {
      const body = await readBoundedBytes(response, MAX_IMAGE_BYTES);
      if (body.truncated || body.bytes.byteLength === 0) {
        return {
          url,
          finalUrl,
          provider: "raw",
          contentType: mediaType,
          content: "Image exceeds the 2 MB content limit or is empty.",
          links: [],
          media: [],
          truncated: true,
        };
      }
      return {
        url,
        finalUrl,
        provider: "raw",
        contentType: mediaType,
        content: "",
        links: [],
        media: [],
        truncated: false,
        image: {
          data: Buffer.from(body.bytes).toString("base64"),
          mimeType: lower,
        },
      };
    }

    if (lower.includes("html")) {
      const body = await readBoundedText(response);
      const page = extractHtml(body.text, finalUrl);
      return {
        url,
        finalUrl,
        provider: "raw",
        contentType: mediaType || "text/html",
        content: page.content,
        links: page.links,
        media: page.media,
        truncated: body.truncated,
      };
    }

    if (
      lower === "" ||
      lower.startsWith("text/") ||
      lower.includes("json") ||
      lower.includes("xml")
    ) {
      const body = await readBoundedText(response);
      return {
        url,
        finalUrl,
        provider: "raw",
        contentType: mediaType || "text/plain",
        content: body.text,
        links: [],
        media: [],
        truncated: body.truncated,
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

  // Check cache
  const cacheKey = cacheKeyFor(url, options);
  const cached = fetchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  if (cached !== undefined) fetchCache.delete(cacheKey);

  // Rate limiting
  if (options.rateLimitMs && options.rateLimitMs > 0) {
    await rateLimit(options.rateLimitMs);
  }

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
      const result = await provider.fetch(request);
      if (signal.aborted) {
        throw new DOMException("fetch aborted", "AbortError");
      }
      if (result.content.trim() !== "") return result;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  const result = await rawFetch(url, {
    fetchImpl,
    signal,
    acceptType: options.acceptType,
    resolveHost: options.resolveHost,
  });

  // Cache result
  const ttl = options.cacheTtlMs ?? 0;
  if (ttl > 0) {
    fetchCache.delete(cacheKey);
    fetchCache.set(cacheKey, { result, expiresAt: Date.now() + ttl });
    while (fetchCache.size > MAX_CACHE_ENTRIES) {
      const oldest = fetchCache.keys().next().value;
      if (oldest === undefined) break;
      fetchCache.delete(oldest);
    }
  }

  return result;
}
