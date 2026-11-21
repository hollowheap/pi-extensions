import {
  type HostResolver,
  MAX_REDIRECTS,
  assertSafeResolvedUrl,
  assertSafeUrl,
} from "./url.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class SafeRedirectError extends Error {}

export interface SafeFetchOptions {
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  resolveHost?: HostResolver;
}

export interface SafeFetchResult {
  response: Response;
  url: string;
}

export async function safeFetchResponse(
  url: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  assertSafeUrl(url);
  let currentUrl = url;

  for (let redirects = 0; ; redirects += 1) {
    await assertSafeResolvedUrl(currentUrl, options.resolveHost);
    const init: RequestInit = {
      signal: options.signal,
      redirect: "manual",
    };
    if (options.headers !== undefined) init.headers = options.headers;
    const response = await options.fetchImpl(currentUrl, init);

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: currentUrl };
    }

    let nextUrl = currentUrl;
    try {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeRedirectError("redirect missing Location header");
      }
      nextUrl = new URL(location, currentUrl).href;
      assertSafeUrl(nextUrl);
      if (redirects >= MAX_REDIRECTS) {
        throw new SafeRedirectError("too many redirects");
      }
    } finally {
      await response.body?.cancel?.();
    }
    currentUrl = nextUrl;
  }
}
