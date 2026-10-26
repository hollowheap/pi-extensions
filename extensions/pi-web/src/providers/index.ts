export * from "./types.js";
export * from "./selection.js";
export * from "./tavily.js";
export * from "./exa.js";
export * from "./firecrawl.js";

import { exaAdapter } from "./exa.js";
import { firecrawlAdapter } from "./firecrawl.js";
import { tavilyAdapter } from "./tavily.js";
import type { ProviderAdapter, ProviderId } from "./types.js";

export const providers: ProviderAdapter[] = [
  exaAdapter,
  tavilyAdapter,
  firecrawlAdapter,
];

export function getProvider(id: ProviderId): ProviderAdapter | undefined {
  return providers.find((provider) => provider.id === id);
}
