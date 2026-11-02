export interface MtimeCacheOptions {
  maxEntries: number;
}

interface CacheEntry<Value> {
  signature: string;
  value: Value;
}

const CACHE_KEY = Symbol.for("@hollowheap/core/mtime-cache");
const MAX_CACHE_ENTRIES = 64;

type CacheStore = Map<string, MtimeCache<unknown>>;

function getStore(): CacheStore {
  const global = globalThis as unknown as Record<
    symbol,
    CacheStore | undefined
  >;
  const existing = global[CACHE_KEY];
  if (existing !== undefined) return existing;
  const created: CacheStore = new Map();
  global[CACHE_KEY] = created;
  return created;
}

export class MtimeCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = Number.isFinite(maxEntries)
      ? Math.max(1, Math.trunc(maxEntries))
      : 1;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, signature: string): Value | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.signature !== signature) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so the least-recently-used entry is evicted.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, signature: string, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, { signature, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export function getMtimeCache<Value>(
  namespace: string,
  options: MtimeCacheOptions = { maxEntries: MAX_CACHE_ENTRIES },
): MtimeCache<Value> {
  const store = getStore();
  const existing = store.get(namespace);
  if (existing !== undefined) {
    return existing as MtimeCache<Value>;
  }
  const created = new MtimeCache<unknown>(options.maxEntries);
  store.set(namespace, created);
  return created as MtimeCache<Value>;
}
