# pi-web

Direct `web_search` and `web_fetch` tools for the Pi coding agent. Both are plain direct tools: no browser, no JavaScript rendering, and no codemode-only surface.

## Try it

```bash
pi -e ./extensions/pi-web
```

## Install

```bash
pi install npm:@hollowheap/pi-web
```

## Providers

| Provider | Search | Fetch | Key |
| --- | --- | --- | --- |
| Exa | yes | yes (Contents) | `EXA_API_KEY` |
| Tavily | yes | yes (Extract) | `TAVILY_API_KEY` |
| Firecrawl | yes | no | `FIRECRAWL_API_KEY` |
| raw HTTP | no | yes | none |

Search defaults to Exa → Tavily → Firecrawl, skipping providers without a key. Fetch defaults to Exa → Tavily → raw HTTP. A failed provider falls through to the next one. Free tiers and quotas change; check each provider before relying on it.

## Configuration

Keys come only from environment variables:

```bash
export EXA_API_KEY=...
export TAVILY_API_KEY=...
export FIRECRAWL_API_KEY=...
```

`<agentDir>/web.json` may override the order arrays. It never stores keys:

```json
{
  "search": { "order": ["tavily", "exa"] },
  "fetch": { "order": ["tavily", "raw"] }
}
```

Unkeyed providers are skipped. Unknown names and `keys` fields are ignored with a diagnostic; keys must stay in the environment. Invalid JSON or non-object roots fall back to defaults.

## Tools

### `web_search`

Input:

- `query` — required.
- `max_results` — optional; default 5, capped at 10.

Output: `{ results, truncated }`, where each result has `title`, `url`, `snippet`, and `provider`.

### `web_fetch`

Input:

- `url` — required public `http`/`https` URL.
- `max_chars` — optional; default 20,000, capped at 100,000.

Output:

```json
{
  "url": "...",
  "finalUrl": "...",
  "provider": "raw",
  "contentType": "text/html",
  "content": "Markdown or text",
  "links": [{ "url": "...", "text": "..." }],
  "media": [{ "url": "...", "kind": "image", "alt": "...", "mimeType": "..." }],
  "truncated": false
}
```

Links cap at 50; media caps at 20. Media metadata is `image`, `video`, `audio`, `pdf`, or `other`. `media` never contains image blocks, base64, or downloaded files; `data:` URLs are dropped from links and media.

## Safety and limits

- Only `http` and `https`; credentialed URLs are rejected.
- Loopback, private, link-local, unspecified, and metadata targets are rejected.
- Raw HTTP redirects are revalidated on every hop and capped at 5.
- DNS rebinding is not hardened: a hostname that resolves to a private address may still pass.
- No browser or JavaScript rendering. JS-only pages may be empty or incomplete.
- Provider requests time out after 15 seconds.
- No response cache: identical calls invoke the provider again.
- `web_search` sends the query to the selected search provider. `web_fetch` sends the URL to the selected fetch provider, or fetches it directly for the raw fallback. Do not send secrets in queries or URLs.
