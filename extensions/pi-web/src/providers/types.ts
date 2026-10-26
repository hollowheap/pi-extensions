export type ProviderId = "tavily" | "exa" | "firecrawl";

export type FetchProvider = ProviderId | "raw";

export type MediaKind = "image" | "video" | "audio" | "pdf" | "other";

export interface NormalizedSearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: ProviderId;
}

export interface NormalizedLink {
  url: string;
  text?: string;
}

export interface NormalizedMedia {
  url: string;
  kind: MediaKind;
  alt?: string;
  mimeType?: string;
}

export interface NormalizedFetchResult {
  url: string;
  finalUrl: string;
  provider: FetchProvider;
  contentType: string;
  content: string;
  links: NormalizedLink[];
  media: NormalizedMedia[];
  truncated: boolean;
}

export interface SearchRequest {
  query: string;
  maxResults?: number;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface FetchRequest {
  url: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface ProviderCapabilities {
  search: boolean;
  fetch: boolean;
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  capabilities: ProviderCapabilities;
  search(input: SearchRequest): Promise<NormalizedSearchResult[]>;
  fetch?(input: FetchRequest): Promise<NormalizedFetchResult>;
}
