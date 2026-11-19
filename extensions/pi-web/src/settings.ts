import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@hollowheap/core/records";

import { readJsonObject, updateJsonConfig } from "@hollowheap/core/config";
import { showSettingsDialog } from "@hollowheap/pi-ui/settings";
import {
  FETCH_ORDER,
  SEARCH_ORDER,
  isFetchProvider,
  isProviderId,
} from "./providers/selection.js";
import type { FetchProvider, ProviderId } from "./providers/types.js";

export const CONFIG_FILE_NAME = "web.json";

export interface WebConfig {
  readonly searchOrder?: readonly ProviderId[];
  readonly fetchOrder?: readonly FetchProvider[];
  readonly path: string;
  readonly diagnostics: readonly string[];
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
  const parsed = readJsonObject(path, diagnostics, {
    readErrorSuffix: "; using defaults",
  });

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

const SEARCH_VALUES = ["default", ...SEARCH_ORDER];
const FETCH_VALUES = ["default", ...FETCH_ORDER];

function searchOrder(value: string): ProviderId[] | undefined {
  if (value === "default") return undefined;
  return [
    value as ProviderId,
    ...SEARCH_ORDER.filter((provider) => provider !== value),
  ];
}

function fetchOrder(value: string): FetchProvider[] | undefined {
  if (value === "default") return undefined;
  return [
    value as FetchProvider,
    ...FETCH_ORDER.filter((provider) => provider !== value),
  ];
}

export async function showWebSettings(
  ctx: ExtensionContext,
  config: WebConfig,
  onSave: (settings: WebSettings) => void,
): Promise<void> {
  let current = config;
  await showSettingsDialog({
    ctx,
    title: "Web settings",
    listHeight: 10,
    items: [
      {
        id: "search-provider",
        label: "Search preference",
        description: "Provider tried first; default keeps the configured order",
        currentValue: current.searchOrder?.[0] ?? "default",
        values: SEARCH_VALUES,
      },
      {
        id: "fetch-provider",
        label: "Fetch preference",
        description:
          "Provider tried first; raw is the final direct-fetch fallback",
        currentValue: current.fetchOrder?.[0] ?? "default",
        values: FETCH_VALUES,
      },
    ],
    onChange: (id, value) => {
      if (id === "search-provider") {
        current = { ...current, searchOrder: searchOrder(value) };
      } else {
        current = { ...current, fetchOrder: fetchOrder(value) };
      }
      onSave({
        searchOrder: current.searchOrder,
        fetchOrder: current.fetchOrder,
      });
    },
  });
}
