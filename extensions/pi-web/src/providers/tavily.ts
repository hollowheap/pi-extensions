import type {
  FetchRequest,
  NormalizedFetchResult,
  NormalizedSearchResult,
  ProviderAdapter,
  ProviderCapabilities,
  SearchRequest,
} from "./types.js";

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

export interface TavilyAdapterOptions {
  apiKey?: string;
  searchUrl?: string;
  extractUrl?: string;
  fetchImpl?: typeof fetch;
}

export class TavilyAdapter implements ProviderAdapter {
  readonly id = "tavily" as const;
  readonly name = "tavily";
  readonly capabilities: ProviderCapabilities = { search: true, fetch: true };

  private apiKey?: string;
  private searchUrl: string;
  private extractUrl: string;
  private fetchImpl?: typeof fetch;

  constructor(options: TavilyAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.searchUrl = options.searchUrl ?? TAVILY_SEARCH_URL;
    this.extractUrl = options.extractUrl ?? TAVILY_EXTRACT_URL;
    this.fetchImpl = options.fetchImpl;
  }

  private key(requestKey?: string): string {
    return requestKey ?? this.apiKey ?? process.env.TAVILY_API_KEY ?? "";
  }

  private headers(key: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
  }

  search = async (input: SearchRequest): Promise<NormalizedSearchResult[]> => {
    const response = await (this.fetchImpl ?? globalThis.fetch)(
      this.searchUrl,
      {
        method: "POST",
        headers: this.headers(this.key(input.apiKey)),
        body: JSON.stringify({
          query: input.query,
          max_results: input.maxResults ?? 5,
        }),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `tavily search failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((item) => ({
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : "",
      snippet:
        typeof item.content === "string"
          ? item.content
          : typeof item.raw_content === "string"
            ? item.raw_content
            : "",
      provider: "tavily",
    }));
  };

  fetch = async (input: FetchRequest): Promise<NormalizedFetchResult> => {
    const response = await (this.fetchImpl ?? globalThis.fetch)(
      this.extractUrl,
      {
        method: "POST",
        headers: this.headers(this.key(input.apiKey)),
        body: JSON.stringify({ urls: [input.url] }),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `tavily extract failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = Array.isArray(data?.results) ? data.results : [];
    const item = results[0] ?? {};
    const content =
      typeof item.raw_content === "string"
        ? item.raw_content
        : typeof item.content === "string"
          ? item.content
          : "";
    const finalUrl = typeof item.url === "string" ? item.url : input.url;
    return {
      url: input.url,
      finalUrl,
      provider: "tavily",
      contentType:
        typeof item.content_type === "string"
          ? item.content_type
          : typeof item.contentType === "string"
            ? item.contentType
            : "",
      content,
      links: [],
      media: [],
      truncated: false,
    };
  };
}

export function createTavilyAdapter(
  options?: TavilyAdapterOptions,
): TavilyAdapter {
  return new TavilyAdapter(options);
}

export const tavilyAdapter = createTavilyAdapter();

export default tavilyAdapter;
