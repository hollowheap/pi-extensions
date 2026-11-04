# pi-web

`web_search` and `web_fetch` codemode tools for the Pi coding agent. No browser and no JavaScript rendering.

Both tools are codemode-only. The extension activates `codemode` on
`session_start` when the built-in extension is registered and the tool is
inactive, so the web tools stay reachable without a manual `/tools` change.

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

Unkeyed providers are skipped. When no search provider has a key, or all configured providers fail, `web_search` falls back to keyless DuckDuckGo HTML search. Unknown names and `keys` fields are ignored with a diagnostic; keys must stay in the environment. Invalid JSON or non-object roots fall back to defaults.

In TUI mode, `/web` opens a settings list for the preferred search and fetch provider. Saving rewrites only the chosen order arrays and preserves unrelated `web.json` fields. `/web insert <n>` pastes a recent search/fetch result URL into the editor; `/web insert` lists the stored links.

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

Links cap at 50; media caps at 20. Media metadata is `image`, `video`, `audio`, `pdf`, or `other`. `media` never contains image blocks, base64, or downloaded files; `data:` URLs are dropped from links and media. Direct PDF URLs are parsed to text locally with `pdftotext` (5 MB input cap, 100k character output cap). Direct PNG/JPEG/GIF/WebP URLs return one image block (2 MB cap); oversized or unsupported images return explanatory text. Videos and audio remain metadata-only.

Expanded `web_search` and `web_fetch` results render as Markdown; collapsed results keep the compact text preview. URLs use OSC 8 hyperlinks when the terminal supports them, and expanded fetches list media metadata under `## Media`. On image-capable terminals, up to two image media entries (2 MB each) are fetched as bounded previews and rendered with the `Image` component; failures fall back to links.

## Safety and limits

- Only `http` and `https`; credentialed URLs are rejected.
- Loopback, private, link-local, unspecified, and metadata targets are rejected.
- Raw HTTP redirects are revalidated on every hop and capped at 5.
- Hostnames are resolved before raw fetches and rejected if any address is private; DNS rebinding between lookup and connect is not hardened.
- Raw response bodies are capped at 5 MB and report `truncated: true` when cut.
- No browser or JavaScript rendering. JS-only pages may be empty or incomplete.
- Provider requests time out after 15 seconds.
- Raw fetches use a 5-minute bounded cache and a serialized 1-second request interval.
- `web_search` sends the query to the selected search provider. `web_fetch` sends the URL to the selected fetch provider, or fetches it directly for the raw fallback. Do not send secrets in queries or URLs.
