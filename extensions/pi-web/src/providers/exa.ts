import type {
  FetchRequest,
  NormalizedFetchResult,
  NormalizedSearchResult,
  ProviderAdapter,
  ProviderCapabilities,
  SearchRequest,
} from "./types.js";

export const EXA_SEARCH_URL = "https://api.exa.ai/search";
export const EXA_CONTENTS_URL = "https://api.exa.ai/contents";

export interface ExaAdapterOptions {
  apiKey?: string;
  searchUrl?: string;
  contentsUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ExaAdapter implements ProviderAdapter {
  readonly id = "exa" as const;
  readonly name = "exa";
  readonly capabilities: ProviderCapabilities = { search: true, fetch: true };

  private apiKey?: string;
  private searchUrl: string;
  private contentsUrl: string;
  private fetchImpl?: typeof fetch;

  constructor(options: ExaAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.searchUrl = options.searchUrl ?? EXA_SEARCH_URL;
    this.contentsUrl = options.contentsUrl ?? EXA_CONTENTS_URL;
    this.fetchImpl = options.fetchImpl;
  }

  private key(requestKey?: string): string {
    return requestKey ?? this.apiKey ?? process.env.EXA_API_KEY ?? "";
  }

  private headers(key: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": key,
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
          numResults: input.maxResults ?? 5,
          contents: { text: true },
        }),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `exa search failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((item) => {
      let snippet = "";
      if (typeof item.text === "string") snippet = item.text;
      else if (Array.isArray(item.highlights)) {
        snippet = item.highlights.map(String).join(" ");
      } else if (typeof item.highlight === "string") {
        snippet = item.highlight;
      } else if (typeof item.snippet === "string") {
        snippet = item.snippet;
      }
      return {
        title: typeof item.title === "string" ? item.title : "",
        url: typeof item.url === "string" ? item.url : "",
        snippet,
        provider: "exa",
      };
    });
  };

  fetch = async (input: FetchRequest): Promise<NormalizedFetchResult> => {
    const response = await (this.fetchImpl ?? globalThis.fetch)(
      this.contentsUrl,
      {
        method: "POST",
        headers: this.headers(this.key(input.apiKey)),
        body: JSON.stringify({ urls: [input.url], text: true }),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `exa contents failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = Array.isArray(data?.results) ? data.results : [];
    const item = results[0] ?? {};
    const content = typeof item.text === "string" ? item.text : "";
    const finalUrl = typeof item.url === "string" ? item.url : input.url;
    return {
      url: input.url,
      finalUrl,
      provider: "exa",
      contentType:
        typeof item.contentType === "string"
          ? item.contentType
          : typeof item.content_type === "string"
            ? item.content_type
            : "",
      content,
      links: [],
      media: [],
      truncated: false,
    };
  };
}

export function createExaAdapter(options?: ExaAdapterOptions): ExaAdapter {
  return new ExaAdapter(options);
}

export const exaAdapter = createExaAdapter();

export default exaAdapter;
