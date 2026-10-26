import type { FetchProvider, ProviderId } from "./types.js";

export const SEARCH_ORDER = ["exa", "tavily", "firecrawl"] as const;
export const FETCH_ORDER = ["exa", "tavily", "raw"] as const;
export const PROVIDER_TIMEOUT_MS = 15_000;

export type EnvLike = Record<string, string | undefined>;

export const PROVIDER_ENV_KEYS: Record<ProviderId, string> = {
  exa: "EXA_API_KEY",
  tavily: "TAVILY_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === "exa" || value === "tavily" || value === "firecrawl";
}

export function isFetchProvider(value: unknown): value is FetchProvider {
  return value === "exa" || value === "tavily" || value === "raw";
}

export function providerEnvKey(provider: ProviderId): string {
  return PROVIDER_ENV_KEYS[provider];
}

export function hasProviderKey(
  provider: ProviderId | "raw",
  env: EnvLike = process.env,
): boolean {
  if (provider === "raw") return true;
  if (!isProviderId(provider)) return false;
  const key = env[PROVIDER_ENV_KEYS[provider]];
  return typeof key === "string" && key.trim() !== "";
}

export function resolveSearchOrder(
  configured?: readonly unknown[],
  env: EnvLike = process.env,
): ProviderId[] {
  const order = configured ?? SEARCH_ORDER;
  const seen = new Set<ProviderId>();
  const result: ProviderId[] = [];
  for (const value of order) {
    if (!isProviderId(value) || seen.has(value)) continue;
    seen.add(value);
    if (hasProviderKey(value, env)) result.push(value);
  }
  return result;
}

export function resolveFetchOrder(
  configured?: readonly unknown[],
  env: EnvLike = process.env,
): FetchProvider[] {
  const order = configured ?? FETCH_ORDER;
  const seen = new Set<FetchProvider>();
  const result: FetchProvider[] = [];
  for (const value of order) {
    if (!isFetchProvider(value) || seen.has(value)) continue;
    seen.add(value);
    if (hasProviderKey(value, env)) result.push(value);
  }
  return result;
}

export function providerSignal(
  signal?: AbortSignal,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export async function withProviderFallback<TProvider, TResult>(
  order: readonly TProvider[],
  attempt: (provider: TProvider) => Promise<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  let lastError: unknown;
  for (const provider of order) {
    if (signal?.aborted) {
      throw new DOMException("provider request aborted", "AbortError");
    }
    try {
      return await attempt(provider);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("no provider available");
}
