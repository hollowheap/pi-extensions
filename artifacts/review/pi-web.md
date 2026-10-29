# pi-web Review

## Public Seams

- `url.ts` exports `isUnsafeHost` (:65), `assertSafeUrl` (:88), `isSafeUrl` (:106), `MAX_REDIRECTS` (:115).
- `extract.ts` exports `decodeEntities` (:10), `stripTags` (:22), `resolveUrl` (:26), `extractTitle` (:50), `extractLinks` (:68), `extractMedia` (:118), `htmlToMarkdown` (:165), `extractHtml` (:222), `ExtractedPage` (:3).
- `fetch.ts` exports `rawFetch` (:55), `fetchUrl` (:165), `FetchOptions` (:12).
- `tools.ts` exports `createWebSearchTool` (:184), `createWebFetchTool` (:319), `WebSearchDeps` (:47), `WebFetchDeps` (:51), constants (:30-36).
- `config.ts` exports `loadWebConfig` (:58), `WebConfig` (:8), `CONFIG_FILE_NAME` (:6).
- `providers/types.ts` — all normalized types and `ProviderAdapter` (:55).
- `providers/selection.ts` — `SEARCH_ORDER`/`FETCH_ORDER` (:3-4), `providerSignal` (:67), `withProviderFallback` (:75), `resolveSearchOrder`/`resolveFetchOrder` (:37/:52), `hasProviderKey` (:27).
- `providers/{exa,tavily,firecrawl}.ts` — adapter classes + factories + URL constants.
- `providers/index.ts` — `providers` array (:12), `getProvider` (:18).

## Robustness Issues

- `fetch.ts:23-26` — module-global `fetchCache` Map is unbounded and never cleared.
- `fetch.ts:172` — cache key is `${url}:${acceptType}` only; omits apiKey/providers, risking stale cross-key results.
- `fetch.ts:28-37` — module-global `lastRequestTime` shared across all callers; concurrent requests bypass rate limit.
- `fetch.ts:92-100` — redirect path calls `assertSafeUrl` before `response.body?.cancel()`; on throw body leaks.
- `fetch.ts:112-116` — non-OK responses throw without canceling body.
- `url.ts:13` — `isPrivateIpv4` uses `Number(part)`, accepting leading-zero/whitespace encodings.
- `extract.ts:83-100` — `mimeFromUrl` calls `new URL(url, ...)` without try/catch.
- `config.ts:65-69` — read errors other than missing file are swallowed with no diagnostic.
- `tools.ts:79-92` — `defaultFetch` ignores `fetchImpl` from request.

## Overengineering

- `fetch.ts:39-53` — `ensureResult` defensive coercion layer over already-normalized provider output.
- `fetch.ts:23-26,171-218` — cache + rate-limit machinery exists but default TTL is 0, so unused unless callers opt in.
- `providers/{exa,tavily,firecrawl}.ts` — class + options interface + factory + singleton per provider; singletons are stateless and mostly redundant.
- `config.ts:46-56` — `diagnoseKeys` feature for a `keys` field that is explicitly unsupported.