import type {
  NormalizedSearchResult,
  ProviderAdapter,
  ProviderCapabilities,
  SearchRequest,
} from "./types.js";

export const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";

export interface FirecrawlAdapterOptions {
  apiKey?: string;
  searchUrl?: string;
  fetchImpl?: typeof fetch;
}

function collectResults(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.web)) {
      return obj.web as Array<Record<string, unknown>>;
    }
    if (Array.isArray(obj.results)) {
      return obj.results as Array<Record<string, unknown>>;
    }
    if (Array.isArray(obj.data)) {
      return obj.data as Array<Record<string, unknown>>;
    }
    if (obj.data) return collectResults(obj.data);
  }
  return [];
}

export class FirecrawlAdapter implements ProviderAdapter {
  readonly id = "firecrawl" as const;
  readonly name = "firecrawl";
  readonly capabilities: ProviderCapabilities = { search: true, fetch: false };

  private apiKey?: string;
  private searchUrl: string;
  private fetchImpl?: typeof fetch;

  constructor(options: FirecrawlAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.searchUrl = options.searchUrl ?? FIRECRAWL_SEARCH_URL;
    this.fetchImpl = options.fetchImpl;
  }

  private key(requestKey?: string): string {
    return requestKey ?? this.apiKey ?? process.env.FIRECRAWL_API_KEY ?? "";
  }

  search = async (input: SearchRequest): Promise<NormalizedSearchResult[]> => {
    const response = await (this.fetchImpl ?? globalThis.fetch)(
      this.searchUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.key(input.apiKey)}`,
        },
        body: JSON.stringify({
          query: input.query,
          limit: input.maxResults ?? 5,
        }),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `firecrawl search failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    const results = collectResults(data);
    return results.map((item) => ({
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : "",
      snippet:
        typeof item.description === "string"
          ? item.description
          : typeof item.snippet === "string"
            ? item.snippet
            : typeof item.content === "string"
              ? item.content
              : typeof item.markdown === "string"
                ? item.markdown
                : "",
      provider: "firecrawl",
    }));
  };
}

export function createFirecrawlAdapter(
  options?: FirecrawlAdapterOptions,
): FirecrawlAdapter {
  return new FirecrawlAdapter(options);
}

export const firecrawlAdapter = createFirecrawlAdapter();

export default firecrawlAdapter;
