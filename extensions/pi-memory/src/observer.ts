import { randomUUID } from "node:crypto";
import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { redactSecrets } from "./redact.js";

export interface ObserverObservation {
  text: string;
  relevance: number;
}

export interface ObserverResult {
  observations: ObserverObservation[];
  usage?: Usage;
}

export interface ObserveOptions {
  registry: ModelRegistry;
  model: Model<Api>;
  conversation: string;
  existing: readonly string[];
  remaining: number;
  redact: boolean;
  signal: AbortSignal;
}

const MAX_OBSERVATION_CHARS = 500;
const MAX_RESPONSE_TOKENS = 2048;

function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function observationArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { observations?: unknown }).observations)
  ) {
    return (value as { observations: unknown[] }).observations;
  }
  return [];
}

export function parseObservationResponse(
  text: string,
  existing: readonly string[],
  remaining: number,
): ObserverObservation[] {
  if (remaining <= 0) return [];
  const seen = new Set(existing.map((item) => item.trim().toLowerCase()));
  const observations: ObserverObservation[] = [];
  for (const item of observationArray(parseJson(text))) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as { text?: unknown; relevance?: unknown };
    if (typeof raw.text !== "string") continue;
    const observationText = raw.text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_OBSERVATION_CHARS);
    if (observationText === "") continue;
    const key = observationText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const relevance =
      typeof raw.relevance === "number" && Number.isFinite(raw.relevance)
        ? Math.min(5, Math.max(1, Math.trunc(raw.relevance)))
        : 3;
    observations.push({ text: observationText, relevance });
    if (observations.length >= remaining) break;
  }
  return observations;
}

export function buildObserverPrompt(
  conversation: string,
  existing: readonly string[],
  redact: boolean,
): string {
  const conversationText = redact ? redactSecrets(conversation) : conversation;
  const existingText = existing
    .slice(-20)
    .map((item) => {
      const text = redact ? redactSecrets(item) : item;
      return `- ${text}`;
    })
    .join("\n");

  return `You maintain durable memory for a coding session. Extract only facts that will help continue the work later:
- user preferences, constraints, and decisions
- project conventions, important paths, commands, and versions
- unresolved problems and agreed next steps

Do not include transient output, secrets, credentials, or speculation. Do not repeat existing observations.

Existing observations:
${existingText || "- (none)"}

Conversation:
<conversation>
${conversationText}
</conversation>

Return JSON only in this shape:
{"observations":[{"text":"one durable fact","relevance":1}]}

Use relevance 1 for marginal facts and 5 for critical constraints. Keep each text under ${MAX_OBSERVATION_CHARS} characters.`;
}

export async function observeConversation(
  options: ObserveOptions,
): Promise<ObserverResult> {
  const prompt = buildObserverPrompt(
    options.conversation,
    options.existing,
    options.redact,
  );
  const response = await options.registry.complete(
    options.model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      maxTokens: MAX_RESPONSE_TOKENS,
      signal: options.signal,
      cacheRetention: "none",
      sessionId: randomUUID(),
    },
  );

  const text = response.content
    .filter(
      (item): item is { type: "text"; text: string } => item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");
  const observations = parseObservationResponse(
    text,
    options.existing,
    options.remaining,
  );
  return {
    observations: observations.map((observation) => ({
      ...observation,
      text: options.redact ? redactSecrets(observation.text) : observation.text,
    })),
    ...(response.usage ? { usage: response.usage } : {}),
  };
}
