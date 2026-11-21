import { Buffer } from "node:buffer";
import { providerSignal } from "./providers/selection.js";
import { SafeRedirectError, safeFetchResponse } from "./safe-fetch.js";
import type { HostResolver } from "./url.js";

export interface MediaPreview {
  data: string;
  mimeType: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CACHED = 8;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const previews = new Map<string, MediaPreview>();

export function setMediaPreview(url: string, preview: MediaPreview): void {
  previews.delete(url);
  previews.set(url, preview);
  while (previews.size > MAX_CACHED) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    previews.delete(oldest);
  }
}

export function getMediaPreview(url: string): MediaPreview | undefined {
  const preview = previews.get(url);
  if (preview === undefined) return undefined;
  previews.delete(url);
  previews.set(url, preview);
  return preview;
}

async function readLimited(
  response: Response,
): Promise<Uint8Array | undefined> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BYTES) return undefined;
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function fetchMediaPreview(
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
  resolveHost?: HostResolver,
): Promise<MediaPreview | undefined> {
  const timeoutSignal = providerSignal(signal, 15_000);
  let response: Response;
  try {
    ({ response } = await safeFetchResponse(url, {
      fetchImpl,
      signal: timeoutSignal,
      resolveHost,
    }));
  } catch (error) {
    if (error instanceof SafeRedirectError) return undefined;
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    return undefined;
  }
  const mimeType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!IMAGE_TYPES.has(mimeType)) {
    await response.body?.cancel?.();
    return undefined;
  }
  const bytes = await readLimited(response);
  if (bytes === undefined || bytes.byteLength === 0) return undefined;
  const preview = {
    data: Buffer.from(bytes).toString("base64"),
    mimeType,
  };
  setMediaPreview(url, preview);
  return preview;
}
