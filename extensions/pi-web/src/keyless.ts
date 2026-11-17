import { decodeEntities, stripTags } from "./extract.js";
import type {
  NormalizedSearchResult,
  SearchRequest,
} from "./providers/types.js";

const SEARCH_URL = "https://html.duckduckgo.com/html/";

function unwrapResultUrl(href: string): string | undefined {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const redirect = url.searchParams.get("uddg");
    return redirect === null ? url.href : decodeURIComponent(redirect);
  } catch {
    return undefined;
  }
}

function textOf(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

/** Keyless DuckDuckGo HTML fallback used when no search provider key is set. */
export async function searchKeyless(
  request: SearchRequest,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<NormalizedSearchResult[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", request.query);
  const response = await fetchImpl(url, {
    signal: request.signal,
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0 (compatible; pi-web/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`keyless search failed: ${response.status}`);
  }
  const html = await response.text();
  const matches = [
    ...html.matchAll(
      /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];
  const limit = Math.max(1, request.maxResults ?? 5);
  const results: NormalizedSearchResult[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match === undefined) continue;
    const tag = match[0];
    const href = tag.match(/href\s*=\s*"([^"]+)"/i)?.[1];
    if (!href) continue;
    const resultUrl = unwrapResultUrl(href);
    const title = textOf(match[1] ?? "");
    if (!resultUrl || title === "") continue;
    const end = matches[index + 1]?.index ?? html.length;
    const block = html.slice(match.index ?? 0, end);
    const snippet = block.match(
      /<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    )?.[1];
    results.push({
      title,
      url: resultUrl,
      snippet: snippet === undefined ? "" : textOf(snippet),
      provider: "duckduckgo",
    });
    if (results.length >= limit) break;
  }
  return results;
}
