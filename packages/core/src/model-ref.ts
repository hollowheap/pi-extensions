const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function formatModelId(model: unknown): string {
  if (typeof model === "string") return model.trim();
  if (typeof model === "object" && model !== null) {
    const raw = model as { provider?: unknown; id?: unknown };
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const provider =
      typeof raw.provider === "string" ? raw.provider.trim() : "";

    if (!id) return "";
    if (!provider) return id;
    if (id.startsWith(`${provider}/`)) return id;
    return `${provider}/${id}`;
  }
  return "";
}

export interface ModelRef {
  model: string;
  thinking?: string;
}

/**
 * Splits Pi's `provider/id:<thinking>` shorthand. Only a trailing valid
 * thinking level counts as a suffix, so model ids that contain colons stay intact.
 */
export function splitModelThinking(raw: string): ModelRef {
  const value = raw.trim();
  const colon = value.lastIndexOf(":");
  if (colon <= 0) return { model: value };
  const level = value.slice(colon + 1).toLowerCase();
  if (!THINKING_LEVELS.has(level)) return { model: value };
  return { model: value.slice(0, colon), thinking: level };
}
