import { readFileSync } from "node:fs";
import { join } from "node:path";
import { updateJsonConfig } from "@hollowheap/core/config";
import { isFetchProvider, isProviderId } from "./providers/selection.js";
import type { FetchProvider, ProviderId } from "./providers/types.js";

export const CONFIG_FILE_NAME = "web.json";

export interface WebConfig {
  readonly searchOrder?: readonly ProviderId[];
  readonly fetchOrder?: readonly FetchProvider[];
  readonly path: string;
  readonly diagnostics: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOrder<T extends string>(
  value: unknown,
  isAllowed: (item: unknown) => item is T,
  section: string,
  diagnostics: string[],
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostics.push(`"${section}.order" must be an array; ignored`);
    return undefined;
  }
  const order: T[] = [];
  const seen = new Set<T>();
  for (const item of value) {
    if (!isAllowed(item)) {
      diagnostics.push(
        `"${section}.order" contains an unknown provider; skipped`,
      );
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    order.push(item);
  }
  return order;
}

function diagnoseKeys(
  value: unknown,
  section: string,
  diagnostics: string[],
): void {
  if (isRecord(value) && value.keys !== undefined) {
    diagnostics.push(
      `"${section}.keys" is ignored; API keys must come from environment variables`,
    );
  }
}

export function loadWebConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): WebConfig {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") {
      diagnostics.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}; using defaults`,
      );
      for (const message of diagnostics) onDiagnostic?.(message);
    }
    return { path, diagnostics };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    diagnostics.push(`${path} is not valid JSON; using defaults`);
    parsed = undefined;
  }
  if (parsed !== undefined && !isRecord(parsed)) {
    diagnostics.push(`${path} must be an object; using defaults`);
    parsed = undefined;
  }

  const root = isRecord(parsed) ? parsed : undefined;
  const search = root?.search;
  const fetch = root?.fetch;
  diagnoseKeys(root, "web", diagnostics);
  diagnoseKeys(search, "search", diagnostics);
  diagnoseKeys(fetch, "fetch", diagnostics);

  const config: WebConfig = {
    searchOrder: parseOrder(
      isRecord(search) ? search.order : undefined,
      isProviderId,
      "search",
      diagnostics,
    ),
    fetchOrder: parseOrder(
      isRecord(fetch) ? fetch.order : undefined,
      isFetchProvider,
      "fetch",
      diagnostics,
    ),
    path,
    diagnostics: Object.freeze(diagnostics),
  };
  if (onDiagnostic !== undefined) {
    for (const message of config.diagnostics) onDiagnostic(message);
  }
  return config;
}

export interface WebSettings {
  searchOrder?: readonly ProviderId[];
  fetchOrder?: readonly FetchProvider[];
}

function setOrder(
  root: Record<string, unknown>,
  key: "search" | "fetch",
  order: readonly string[] | undefined,
): void {
  const section = isRecord(root[key]) ? { ...root[key] } : {};
  if (order === undefined) {
    Reflect.deleteProperty(section, "order");
  } else {
    section.order = [...order];
  }
  root[key] = section;
}

/** Persist provider order while preserving unrelated config fields. */
export function saveWebSettings(
  agentDir: string,
  settings: WebSettings,
): string {
  const path = join(agentDir, CONFIG_FILE_NAME);
  const res = updateJsonConfig(path, (root) => {
    setOrder(root, "search", settings.searchOrder);
    setOrder(root, "fetch", settings.fetchOrder);
  });
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.path;
}
