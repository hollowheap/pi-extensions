# Review — pi-web (V16)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Public Seams

- `url.ts` exports `isUnsafeHost` (:65), `assertSafeUrl` (:88), `isSafeUrl` (:106), `MAX_REDIRECTS` (:115).
- `extract.ts` exports `decodeEntities` (:10), `stripTags` (:22), `resolveUrl` (:26), `extractTitle` (:50), `extractLinks` (:68), `extractMedia` (:118), `htmlToMarkdown` (:165), `extractHtml` (:222), `ExtractedPage` (:3).
- `fetch.ts` exports `rawFetch` (:55), `fetchUrl` (:165), `FetchOptions` (:12).
- `tools.ts` exports `createWebSearchTool` (:184), `createWebFetchTool` (:319), `WebSearchDeps` (:47), `WebFetchDeps` (:51), constants (:30-36).
- `config.ts` exports `loadWebConfig` (:58), `WebConfig` (:8), `CONFIG_FILE_NAME` (:6).
- `providers/types.ts` — all normalized types and `ProviderAdapter` (:55).
- `providers/selection.ts` — `SEARCH_ORDER`/`FETCH_ORDER` (:3-4), `providerSignal` (:67), `withProviderFallback` (:75), `resolveSearchOrder`/`resolveFetchOrder` (:37/:52), `hasProviderKey` (:27).
- `providers/{exa,tavily,firecrawl}.ts` — adapter classes + factories + URL constants.
- `providers/index.ts` — `providers` array (:12), `getProvider` (:18).

### Robustness Issues

- Resolution (2026-11-01): `fetchCache` is capped at 32 entries and evicts the oldest result.
- Resolution (2026-11-01): Cache keys include URL, accept type, API-key hash, provider set, and custom-fetch marker.
- Resolution (2026-11-01): Rate limiting is serialized through a promise queue; concurrent calls cannot bypass the interval.
- Resolution (2026-11-01): Redirect and non-OK response bodies are cancelled before throwing.
- Resolution (2026-11-01): `defaultFetch` now enables a 5-minute cache TTL and 1-second rate limit.
- Resolution (2026-11-01): Non-canonical IPv4 octets are rejected as unsafe before numeric comparison.
- Resolution (2026-11-01): `mimeFromUrl` catches malformed URLs and returns no MIME hint.
- Resolution (2026-11-01): Unreadable `web.json` paths now produce a diagnostic instead of being treated as missing.
- Resolution (2026-11-01): `FetchRequest` no longer carries a `fetchImpl`; the custom implementation remains a test seam on `FetchOptions`.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `fetch.ts:39-53` — `ensureResult` defensive coercion over already-normalized provider output. | R02, R03 | **Fixed (2026-11-04).** `ensureResult` was removed; `fetchUrl` consumes provider output directly. R02/R03 require one normalized result shape, and every adapter already returns that shape. |
| `fetch.ts:23-26,171-218` — cache + rate-limit machinery with default TTL 0. | R56, D128 | **Required, not overengineering.** R56/D128 explicitly require TTL response caching and a request queue for rate limiting; D86's earlier deferral is superseded. The defect is that defaults and tool wiring leave both inert, not that the feature exists. |
| `providers/{exa,tavily,firecrawl}.ts` — class + options interface + factory + singleton per provider. | R02, R03, D78 | **Partly required.** D78 requires a separate adapter per provider that normalizes into the two shapes. The class/options/factory layers are the test and config seams for that adapter; the stateless singletons are redundant but trivial. |
| `config.ts:46-56` — `diagnoseKeys` feature for a `keys` field that is explicitly unsupported. | R04, D81 | **Required, not overengineering.** R04/D81 require keys to come only from environment variables and never be stored in `web.json`. Warning when `keys` appears is the enforcement path for that contract. |

### Verified Bugs (2026-10-29)

Probes: `artifacts/scripts/probe-web-ssrf.ts`,
`artifacts/scripts/probe-web-fallbacks.ts`.

| Severity | Finding | Evidence |
| --- | --- | --- |
| Fixed | DNS-resolved SSRF bypass is blocked: raw fetches resolve every hostname and reject private results. Rebinding between lookup and connect remains out of scope. | Covered by `url.test.ts` and `fetch.test.ts`. |
| Fixed | Raw response bodies are capped at 5 MB and return `truncated: true` instead of reading without bound. | Covered by `fetch.test.ts`. |
| Fixed | Empty search results now fall through to later providers; all-empty returns `[]`. | Covered by `selection.test.ts`. |
| Fixed | Non-OK and redirect response bodies are now cancelled before rejection. | Covered by `fetch.test.ts`. |
| Fixed | Keyless search falls back to DuckDuckGo HTML when no provider key is configured or all providers fail. | Covered by `keyless.test.ts`. |
| Fixed | Cache and rate limiter are now active in `defaultFetch` with bounded entries and serialized request starts. | Covered by `fetch.test.ts`. |
| Fixed | README now describes both tools as codemode tools. | Doc updated. |
| Fixed | Numeric entities use `String.fromCodePoint`, including hex and astral code points; invalid ranges become U+FFFD. | Covered by `extract.test.ts`. |

### Upstream Comparison

`pi-web-access@0.46.0` is strictly stronger on the two critical paths:
`ssrf-protection.ts` resolves DNS and checks every address against CIDR ranges,
and `fetchRemoteUrl` bounds reads. It also ships keyless Exa MCP and DuckDuckGo.
See `artifacts/research/pi-extension-landscape.md`.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — overengineering findings resolved.
