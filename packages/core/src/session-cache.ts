import { getState } from "./registry.js";

export interface SessionCacheOptions {
  maxEntries: number;
}

interface CacheEntry<Value> {
  value: Value;
  expires?: number;
}

export class SessionCache<Value> {
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

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expires !== undefined && entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so the least-recently-used entry is evicted.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, ttlMs?: number): void {
    this.entries.delete(key);
    const entry: CacheEntry<Value> = { value };
    if (ttlMs !== undefined && Number.isFinite(ttlMs)) {
      entry.expires = Date.now() + Math.max(0, ttlMs);
    }
    this.entries.set(key, entry);
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

export function getSessionCache<Value>(
  owner: object,
  namespace: string,
  options: SessionCacheOptions,
): SessionCache<Value> {
  const caches = getState().caches;
  let namespaces = caches.get(owner);
  if (namespaces === undefined) {
    namespaces = new Map();
    caches.set(owner, namespaces);
  }
  const existing = namespaces.get(namespace);
  if (existing !== undefined) {
    return existing as SessionCache<Value>;
  }
  const created = new SessionCache<unknown>(options.maxEntries);
  namespaces.set(namespace, created);
  return created as SessionCache<Value>;
}
