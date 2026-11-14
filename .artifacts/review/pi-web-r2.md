# Review — pi-web re-review (V25)

## Scope

- Paths: `extensions/pi-web/src/**` (about 2612 LOC incl. tests), `extensions/pi-web/index.ts`, `extensions/pi-web/README.md`.
- Commit: `a035b03` (HEAD). Last pi-web commit: `414eaef` "forward abort signals to search and fetch".
- Lenses: robustness/security, backend, UI (TUI), performance, simplicity.
- Prior review: `artifacts/review/pi-web.md` (V16).
- Baseline run: `npx vitest run extensions/pi-web` → 14 files, 96/96 pass.
- Probes: run out-of-tree under `/tmp/pi-web-r2` through the repo's `jiti` (`createJiti` from `node_modules/jiti`, `await j.import("<abs>/src/x.ts")`), then deleted. Probe stubs replace `fetch`; no network. Repro lines below use the same loader.
- Shared packages (`packages/tui`, `packages/runtime`, `packages/core`) are out of scope. Usage findings only where this slice misuses them. None found: `Text` wrapping (`@earendil-works/pi-tui`) wraps long URLs, and `truncateToWidth` is used in `settings.ts:95`.

## Prior resolutions

- Cache capped at 32 entries, oldest evicted: holds (`fetch.ts:41`, `fetch.ts:365-369`). Entry count is not a byte bound; see F7.
- Cache key includes URL, accept type, API-key hash, provider set, custom-fetch marker: holds (`fetch.ts:69-77`).
- Rate limit serialized through a promise queue: holds for ordering (`fetch.ts:47-67`). Queue ignores abort; see F6.
- Redirect and non-OK bodies cancelled before throw: holds (`fetch.ts:173-175`, `fetch.ts:184`; `media.ts:93`, `media.ts:99`).
- `defaultFetch` enables 5-min TTL and 1-s rate limit: holds (`tools.ts:51-52`, `tools.ts:168-169`).
- Non-canonical IPv4 octets rejected: holds (`url.ts:26`).
- `mimeFromUrl` catches malformed URLs: holds (`extract.ts:97-103`).
- Unreadable `web.json` produces a diagnostic: holds at the producer (`config.ts:67-74`). Diagnostics never reach tool calls; see F12.
- `FetchRequest` carries no `fetchImpl`: holds (`providers/types.ts:152-156`).
- Verified-bug table, spot-checked: DNS-resolved SSRF check holds (`url.ts:130-154`, `fetch.ts:147`); 5 MB body cap holds (`fetch.ts:20`, `fetch.ts:91-98`); empty-result fallthrough holds (`providers/selection.ts:88-91`); keyless fallback holds (`tools.ts:141-152`). Numeric entity decoding holds for single-level input; see F11.

Regressed: 0 of 9 Resolution lines.

Abort forwarding in `414eaef`, end to end:
- Search: `tools.ts:357-382` passes `signal` → `defaultSearch` (`tools.ts:140`, `providerSignal`) → `withProviderFallback` (`selection.ts:75-102`) → adapter `search` (`exa.ts:59`, `tavily.ts:58`, `firecrawl.ts:66`) → `fetch`. Keyless: `keyless.ts:33`. Holds, but a provider timeout is terminal; see F4.
- Fetch: `tools.ts:559` → `defaultFetch` (`tools.ts:164-170`) → `fetchUrl` (`fetch.ts:328`) → adapter `fetch` (`exa.ts:94`, `tavily.ts:88`) → `rawFetch` (`fetch.ts:148-152`) → body reads and PDF `execFile` (`pdf.ts:21`). Holds, except DNS (F5), rate-limit wait (F6), and media previews (F1).
- Retries: none exist in this slice (`grep -rn retr src` finds none).

## Findings

### F1
- Severity: high
- Lens: robustness (hang)
- Current: `media.ts:80-84` awaits `fetchImpl(currentUrl, { signal, redirect: "manual" })` with no timeout; `media.ts:43-69` `readLimited` has no time bound. `tools.ts:571-590` awaits `Promise.all` of previews before returning the fetch result.
- Gap: `signal` is optional. When the host passes none, nothing bounds the request. Even with a signal, nothing bounds a slow-drip body.
- Failure/impact: one unresponsive image host in a fetched page blocks `web_fetch` until the user cancels. With no signal, it never returns.
- Reproduction: `fetchMediaPreview("http://93.184.216.34/a.png", undefined, () => new Promise(() => {}))` is still pending after 1.5 s (media.ts:71-84).
- Fix: wrap previews in a deadline, e.g. `providerSignal(signal, 5_000)` in `media.ts:72`, and pass the combined signal to `fetchImpl` and `readLimited`.
- Confidence: high (probe).

### F2
- Severity: high
- Lens: performance (synchronous hang on main thread)
- Current: `extract.ts:233` `.replace(/<[^>]+>/g, " ")` and `extract.ts:37` `stripTags` `/<[^>]+>/g`. Unclosed paired-tag patterns: `extract.ts:226` `<p\b[^>]*>([\s\S]*?)<\/p>`, `extract.ts:221` `<li>`, `extract.ts:193` `<h[1-6]>`, `extract.ts:203` `<a href>`.
- Gap: `[^>]+` scans to the end of input from every `<` that has no later `>`. Lazy `[\s\S]*?` scans to the end from every unclosed opener. Both are O(n²). The 5 MB body cap (`fetch.ts:20`) is applied before parsing, so the cost runs at full size on the event loop.
- Failure/impact: a crafted page with many `<` and no `>` stalls the pi process for seconds, and more at 5 MB. Measured: 100 KB takes 1.0 s, 200 KB takes 25.7 s.
- Reproduction: `htmlToMarkdown("<".repeat(200000))` → 25.7 s (measured). `htmlToMarkdown("x<y ".repeat(20000))` → 1025 ms; `"x<y ".repeat(10000)` → 259 ms (quadratic, ×4 per doubling). `htmlToMarkdown("<p>word ".repeat(32000))` → 865 ms; `16000` → 228 ms. 5 MB is UNVERIFIED by direct run. It follows from the measured growth rate.
- Fix: change both tag regexes to `/<[^<>]*>/g`, which bounds each scan to the next `<`. Cap input before parsing (for example 1 MB) and return `truncated: true`. Replace the lazy paired-tag patterns with a single linear tokenizer, or bound them with `[\s\S]{0,N}?`.
- Confidence: high for measured timings; UNVERIFIED at 5 MB.

### F3
- Severity: high (data loss)
- Lens: backend
- Current: `config.ts:123-130` `readRoot` returns `{}` on any read or parse error. `config.ts:147-162` `saveWebSettings` then writes that `{}`-based root over the file.
- Gap: a `web.json` with comments, a trailing comma, or any unknown field is replaced wholesale when the user changes a setting in `/web settings`. The original file is not backed up.
- Failure/impact: user config fields are silently deleted. Secrets are not affected: `keys` is never stored by design (`config.ts:46-56`).
- Reproduction: write `{ // my notes\n "search": { "order": ["exa"] }, "custom": true, \n}` to `<agentDir>/web.json`, then call `saveWebSettings(agentDir, { searchOrder: ["tavily"] })`. Result: `{"search":{"order":["tavily"]},"fetch":{}}`. The comment and `"custom"` are gone (probe p2, P9).
- Fix: if the existing file exists but does not parse, throw before writing (surfaced by `index.ts:111-119`), or copy it to `web.json.bak` first.
- Confidence: high (probe).

### F4
- Severity: medium
- Lens: robustness (fallback on error)
- Current: `providers/selection.ts:67-73` builds one 15 s deadline for the whole call. `selection.ts:94` rethrows any error once `signal.aborted`. `fetch.ts:344-350` does the same. `tools.ts:151` does the same for search.
- Gap: the deadline is shared by all providers, and a provider timeout sets `signal.aborted`. The code cannot tell a user cancel from a provider timeout, so a timed-out provider aborts the fallback chain.
- Failure/impact: a slow Exa stops the whole `web_search` (Tavily never tried) and the whole `web_fetch` (raw never tried). The model receives `unavailable: ... aborted`.
- Reproduction: `withProviderFallback([hangingExa, tavily], p => p.search({signal}), providerSignal(undefined, 300))` throws `exa hung`; tavily is never called (probe P11). `fetchUrl(url, { providers: [hangingProvider], fetchImpl: rawStub, timeoutMs: 300 })` rejects; raw content is available but not used (probe P1).
- Fix: give each provider its own `providerSignal(options.signal, PROVIDER_TIMEOUT_MS)`. Rethrow only when the caller's `options.signal` is aborted.
- Confidence: high (probe).

### F5
- Severity: medium
- Lens: robustness (abort)
- Current: `url.ts:13` `lookup(hostname, { all: true })`. `url.ts:144` `await resolve(hostname)` takes no signal. `fetch.ts:147` and `media.ts:80` call `assertSafeResolvedUrl` without a signal.
- Gap: DNS resolution is not raced against the abort signal, so a cancelled `web_fetch` keeps waiting on the resolver.
- Failure/impact: cancellation does not return control until the OS resolver gives up. Node's `dns.lookup` takes no signal, so the fix must race the promise.
- Reproduction: `rawFetch("http://example.test/x", { fetchImpl: stub, signal, resolveHost: () => new Promise(() => {}) })` where `signal` aborts at 100 ms. The promise is still pending at 1.5 s (probe P3).
- Fix: add a `signal` parameter to `assertSafeResolvedUrl` and race `resolve(hostname)` against an abort promise.
- Confidence: high (probe with a stub resolver). Real `getaddrinfo` timing UNVERIFIED.

### F6
- Severity: medium
- Lens: robustness (rate limit under abort)
- Current: `fetch.ts:324-326` calls `rateLimit` before any signal check. `fetch.ts:61` sleeps with `setTimeout` and no abort. `fetch.ts:63` sets `lastRequestTime` even for calls that will abort.
- Gap: a call whose signal is already aborted still waits its turn in the queue, and it still consumes a slot.
- Failure/impact: N aborted calls behind one fetch wait N × `rateLimitMs`. With the 1 s default, that is N seconds of blocked tool calls.
- Reproduction: after one successful call, `fetchUrl(url2, { providers: [], fetchImpl, rateLimitMs: 500, signal: alreadyAborted })` took 464 ms before it returned (probe P2). The stub ignores the signal, so the 464 ms wait is the measured fact; the rejection with real fetch is expected but not run.
- Fix: check `options.signal?.aborted` before `rateLimit`, and make the sleep `setTimeout` abortable. Remove the slot if the wait is aborted.
- Confidence: high for the wait; medium for the full queue effect.

### F7
- Severity: medium
- Lens: performance / cache bounds
- Current: `fetch.ts:41` `MAX_CACHE_ENTRIES = 32`. `fetch.ts:362-369` stores the full `NormalizedFetchResult` with no size check.
- Gap: the bound counts entries, not bytes. Each entry can hold 5 MB text, plus up to ~2.7 MB base64 image data.
- Failure/impact: 33 distinct 5 MB pages raise the heap by 158 MB and keep it for the 5-min TTL.
- Reproduction: 33 calls to `fetchUrl("http://93.184.216.<100+i>/big", { providers: [], fetchImpl: stub5MB, cacheTtlMs: 300000 })`, then compare `heapUsed` (probe P10: +158 MB).
- Fix: track total bytes (`content.length + image?.data.length`) and evict until under a byte cap (e.g. 32 MB). Or skip caching results above 1 MB.
- Confidence: high (probe).

### F8
- Severity: medium
- Lens: backend (malformed charset)
- Current: `fetch.ts:116-119` `new TextDecoder().decode(body.bytes)` always decodes UTF-8. Used for HTML (`fetch.ts:262-263`) and text (`fetch.ts:282-283`).
- Gap: the `charset` parameter of `Content-Type` and `<meta charset>` are ignored.
- Failure/impact: ISO-8859-1, Windows-1252, Shift_JIS, and GBK pages reach the model as replacement characters.
- Reproduction: `rawFetch("http://93.184.216.34/p", { fetchImpl })` where the response is `<p>caf\xe9</p>` with `content-type: text/html; charset=iso-8859-1`. Content is `"caf\uFFFD"` (probe P6).
- Fix: parse `charset` from `Content-Type`, then `<meta charset>` in the first 1 KB. Decode with `new TextDecoder(label)` and fall back to UTF-8 on an unknown label.
- Confidence: high (probe).

### F9
- Severity: medium
- Lens: backend (PDF limit contract)
- Current: `pdf.ts:21` `maxBuffer: MAX_PDF_CHARS * 4` (400 KB, bytes). `pdf.ts:49-52` truncates to `MAX_PDF_CHARS` only after the full output is buffered.
- Gap: `execFile` kills the child when stdout exceeds 400 KB. The truncation branch is reached only for output between 100 KB and 400 KB.
- Failure/impact: any PDF whose `pdftotext -layout` output exceeds ~400 KB returns `PDF text extraction failed: pdf extraction failed: stdout maxBuffer length exceeded` instead of the first 100 K chars with `truncated: true`.
- Reproduction: put a fake `pdftotext` that prints about 1 MB on `PATH` (probe P12). `extractPdfText` throws `stdout maxBuffer length exceeded`. `rawFetch` on a PDF response returns that text as `content` with `truncated: false` (probe P12b).
- Fix: stream stdout and stop after `MAX_PDF_CHARS` characters (or raise `maxBuffer` to `MAX_PDF_CHARS * 4 * 4` and slice).
- Confidence: high (probe with a fake binary).

### F10
- Severity: medium
- Lens: UI
- Current: `tools.ts:316` and `tools.ts:456` treat a result as an error when `firstText(result)` contains the substring `unavailable:`.
- Gap: the check scans the whole rendered body, including fetched page text. The intended signal is `details.error`.
- Failure/impact: a successful fetch whose page contains `unavailable:` renders as a red error line, and the collapsed view hides the fetched summary.
- Reproduction: `renderResult` for a `web_fetch` whose body text is `"Status line: service unavailable: retry later"` returns the text styled as `error` (probe P8).
- Fix: check `details?.error !== undefined` only. Remove the substring test.
- Confidence: high (probe).

### F11
- Severity: medium
- Lens: backend (wrong content)
- Current: `extract.ts:10-14` replaces `&amp;` before `&lt;`, `&gt;`, `&quot;`, `&#39;`. `extract.ts:234` runs `decodeEntities(out)` on the final output again.
- Gap: decoding is sequential, so `&amp;lt;` becomes `&lt;`, then `<`. Each entity is decoded twice.
- Failure/impact: a page that shows the literal text `&lt;b&gt;` (for example, an HTML tutorial) reaches the model as `<b>`.
- Reproduction: `htmlToMarkdown("<p>&amp;lt;b&amp;gt;</p>")` returns `<b>` (probe P7). Also `decodeEntities("&amp;#39;")` returns `'`.
- Fix: decode in one pass with one regex: `/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi` and a lookup table. Decode once, after tag stripping.
- Confidence: high (probe).

### F12
- Severity: medium
- Lens: backend (dead config on tool path)
- Current: `tools.ts:138` and `tools.ts:159` call `loadWebConfig(getAgentDir())` with no `onDiagnostic`. `config.ts:58-61` accepts the callback. Only `index.ts:106-108` reads `config.diagnostics`, and only in `/web settings`.
- Gap: invalid JSON, a non-object root, unreadable files, and `keys` warnings are dropped on every search and fetch call.
- Failure/impact: a `web.json` with a syntax error silently uses default provider order. The user sees no notice in normal tool use.
- Reproduction: write `{` to `<agentDir>/web.json` and call `loadWebConfig(agentDir).diagnostics`. It returns `"... is not valid JSON; using defaults"`. Nothing on the tool path reads it (grep: no other `diagnostics` consumer in `src`).
- Fix: surface diagnostics once per process via `ctx.ui.notify` on first tool use, or put them in `details` of the tool result. Then `onDiagnostic` becomes used.
- Confidence: high (code path; runtime notice UNVERIFIED in the host UI).

### F13
- Severity: medium
- Lens: backend (wrong attribution)
- Current: `keyless.ts:41-45` collects all `result__snippet` texts into `snippets`. `keyless.ts:60` assigns `snippets[results.length]`.
- Gap: the snippet index is based on the count of accepted results, but the snippet list is built from all snippet elements. One result with no snippet shifts every later snippet onto the wrong result.
- Failure/impact: DuckDuckGo fallback search attaches wrong snippets to results.
- Reproduction: HTML with result A (title only) followed by result B (title plus `result__snippet` "Beta snippet"). `searchKeyless` returns A with snippet `"Beta snippet"` and B with `""` (probe P5).
- Fix: parse each `result__a` block and take the snippet from the same block, or walk the match list by position in a single pass.
- Confidence: high (probe).

### F14
- Severity: medium (high if reachable; reachability UNVERIFIED)
- Lens: security (SSRF guard)
- Current: `url.ts:45-77` `isPrivateIpv6` checks `::`, `::1`, mapped `::ffff:`, `fe80::/10`, `fc00::/7`. It does not check NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compatible `::/96`, or `::ffff:0:0/96`.
- Gap: literal IPv6 forms that embed an IPv4 address are allowed. `assertSafeResolvedUrl` skips IP literals (`url.ts:140`), so nothing else checks them.
- Failure/impact: `http://[64:ff9b::7f00:1]/` and `http://[2002:7f00:1::]/` pass `assertSafeUrl`. If the host runs a NAT64 translator, traffic reaches the loopback IPv4 of that host (UNVERIFIED).
- Reproduction: `assertSafeUrl("http://[64:ff9b::7f00:1]/")` and `assertSafeUrl("http://[2002:7f00:1::]/")` do not throw (probe P4). `http://[::ffff:7f00:1]/` is blocked, as expected.
- Fix: extract the embedded IPv4 for `64:ff9b::/96` (last 32 bits), `2002::/16` (bits 16–48), and `::/96`, and run `isPrivateIpv4` on it.
- Confidence: high for "allowed by the guard"; UNVERIFIED for host reachability.

### F15
- Severity: low
- Lens: simplicity (deletion test)
- Current:
  - `providers/index.ts:181-189` (`providers`, `getProvider`) has no importer in the repo.
  - `exa.ts:134`, `tavily.ts:134`, `firecrawl.ts:100` singletons are used only by that barrel.
  - `url.ts:120` `isSafeUrl` is used only in `url.test.ts`.
  - `fetch.ts:21` exports `MAX_IMAGE_BYTES`, used only inside the file.
  - `fetch.ts:36`, `fetch.ts:76`, `fetch.ts:127`, `fetch.ts:134`: `acceptType` is never set by `defaultFetch` (`tools.ts:164-170`).
  - `fetch.ts:30`, `fetch.ts:342`, `tools.ts:165`, `providers/types.ts:148`: `apiKey` plumbing is never set by the tool. Adapters read env directly.
  - `config.ts:60`: `onDiagnostic` has no production caller (see F12).
  - `media.ts:74-75`: `fetchImpl` and `resolveHost` are used only by tests.
  - `tools.ts:124-133` `adapterFor` and `fetchAdapterFor` duplicate the barrel singletons.
- Gap: each item is reachable only from tests or not at all.
- Failure/impact: maintenance surface and misleading API; `apiKey` looks like a working per-request override but is not.
- Reproduction: `grep -rn "providers/index\|getProvider" extensions/pi-web/src index.ts` finds no importer.
- Fix: delete `providers/index.ts` and the three singletons; drop `acceptType` and request-level `apiKey`; un-export `MAX_IMAGE_BYTES` and `isSafeUrl`, or keep `isSafeUrl` only if tests need it.
- Confidence: high.

### F16
- Severity: low
- Lens: robustness (unbounded read)
- Current: `keyless.ts:40` `const html = await response.text();` has no byte cap.
- Gap: the fallback reads the full body; the 15 s signal is the only bound.
- Failure/impact: the host is fixed (`html.duckduckgo.com`), so exposure is low. Still inconsistent with the 5 MB cap used for fetches.
- Reproduction: not run. Code reading only.
- Fix: read through `readBoundedText`-style capped reader (`fetch.ts:79-109`).
- Confidence: high on code, low impact.

### F17
- Severity: low
- Lens: UI
- Current: `tools.ts:530` `const snippet = l.length > 120 ? \`${l.slice(0, 117)}...\` : l;`
- Gap: `slice` counts UTF-16 code units, so it can split a surrogate pair.
- Failure/impact: the collapsed line ends in a lone surrogate, which renders as a replacement glyph.
- Reproduction: `"😀".repeat(70).slice(0, 117)` ends with a lone high surrogate (checked with `node -e`).
- Fix: slice by code points (`Array.from(l).slice(0, 117).join("")`) or by display width with `truncateToWidth` from `@earendil-works/pi-tui`, which `settings.ts` already uses.
- Confidence: high.

## Failure modes

- Collapsed `web_fetch` view shows the first 8 non-empty raw lines of page text (`tools.ts:526-532`). On most pages those lines are navigation and cookie text, so the collapsed view often carries no useful summary.
- Each `web_fetch` result stores full `content` (up to 100 K chars, `tools.ts:616`) and the image base64 (up to 2 MB, about 2.7 MB encoded, `tools.ts:620`) in `details`. The session transcript keeps both.
- Two identical concurrent `fetchUrl` calls both miss the cache, because the cache is written after `rawFetch` completes (`fetch.ts:316-321`, `fetch.ts:362-368`). Rate limiting serializes them but does not dedupe. UNVERIFIED in a live run.
- A timed-out provider surfaces as `web_fetch unavailable: fetch aborted` (`fetch.ts:344-345`, `tools.ts:626`). The model cannot tell a timeout from a user cancel.
- Provider errors are swallowed silently (`fetch.ts:348-350`, `selection.ts:94-96`). A broken key looks identical to a fallback to raw.
- `lastWebLinks` is a module-level global (`tools.ts:53-69`). Links from one session appear in `/web insert` in another session in the same process.
- Fetching a page triggers up to 2 extra requests to image hosts named in that page (`tools.ts:571-590`). Those requests come from the user's IP and are not visible in the transcript.

## Seams

- `url.ts` (guard) is used by `fetch.ts:131`, `fetch.ts:147`, `fetch.ts:167` and `media.ts:79-80`. Both redirect loops (`fetch.ts:146-177`, `media.ts:77-119`) reimplement redirect handling and status codes. A single helper would remove duplication, but the two differ in overflow behavior (see below).
- Two bounded-body readers: `fetch.ts:79-109` truncates and returns `truncated: true`. `media.ts:43-69` drops the whole body. Callers rely on different semantics.
- Timeout ownership is split: `providerSignal` is called in `tools.ts:140` (search), `fetch.ts:328` (fetch), and per-call in `selection.ts:67`. That split is the cause of F4.
- `tools.ts:124-133` builds adapters from scratch per call. That duplicates `providers/index.ts` (F15) and removes the only reason for a singleton.
- No shared-package misuse found in this slice.

## Rejected defaults

- `PROVIDER_TIMEOUT_MS = 15_000` (`selection.ts:5`): reasonable default; the issue is shared use (F4), not the value.
- `MAX_RESPONSE_BYTES` 5 MB, `MAX_IMAGE_BYTES` 2 MB, `MAX_REDIRECTS` 5: explicit caps, all enforced.
- `FETCH_CACHE_TTL_MS` 5 min and `FETCH_RATE_LIMIT_MS` 1 s (`tools.ts:51-52`): configured constants, not defects.
- Per-call `loadWebConfig` (`tools.ts:138`, `tools.ts:159`): one small synchronous read per web tool call. No measured cost and it picks up edits without restart.
- `http://010.0.0.1/` is allowed: WHATWG URL parsing normalizes it to `8.0.0.1` before the guard runs. Canonical host is checked.
- `http://2130706433/`, `http://0x7f.1/`, `http://127.1/` are blocked after normalization (probe P4).
- `http://[::7f00:1]/` (IPv4-compatible) is allowed. On Linux, connect does not route `::/96` to IPv4 loopback.
- `http://[ff02::1]/` (multicast) is allowed. TCP connect to multicast fails; no SSRF impact.
- `http://[::ffff:0:7f00:1]/` (SIIT form) is allowed. The kernel does not translate it on a normal host (UNVERIFIED on hosts with SIIT).
- `198.18.0.0/15` is only partly blocked (`url.ts:40` checks `b === 18` and `b === 51`; `198.19/16` is open). Benchmark space is not internal; no SSRF impact.
- Adding a cache single-flight or per-host rate limits: no measured problem.

## Open Questions

1. DNS rebinding residual (accepted in V16). The guard resolves the host with `lookup` (`url.ts:13`), then undici resolves it again for `connect` (`fetch.ts:148`). A short-TTL attacker host can answer public first and private second. Options: accept and document, or pin the checked address through an undici dispatcher with a custom `connect.lookup`. The second needs the `undici` package, whose availability in this environment is UNVERIFIED.
2. Should image previews run at all on a `web_fetch`? They add outbound requests the user did not ask for (`tools.ts:571-590`). Decide whether to keep them, make them opt-in, or limit them to the same origin.
3. When a provider times out, should the chain continue to the next provider and raw? F4 assumes yes. That matches the "raw is the final direct-fetch fallback" wording in `settings.ts:66`.

## Verdict

fail

Three high findings: F1 (web_fetch hangs on an unresponsive image host), F2 (quadratic HTML regexes stall the event loop; 25.7 s for 200 KB of lone `<`), F3 (`/web settings` overwrites an unparseable `web.json`). Eleven medium findings (F4–F14, with F14 medium pending reachability) and three low findings (F15–F17) follow in the list above.
