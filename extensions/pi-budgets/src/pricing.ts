export interface ModelPricingRates {
  input: number; // cost per million prompt tokens (USD)
  output: number; // cost per million completion tokens (USD)
  cacheRead?: number; // cost per million cache read tokens (USD)
  cacheWrite?: number; // cost per million cache write tokens (USD)
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricingRates> = {
  // Anthropic Claude
  "claude-3-5-sonnet": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-3-5-haiku": {
    input: 0.8,
    output: 4.0,
    cacheRead: 0.08,
    cacheWrite: 1.0,
  },
  "claude-3-opus": {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  o1: { input: 15.0, output: 60.0 },
  "o3-mini": { input: 1.1, output: 4.4 },
  // Google Gemini
  "gemini-1.5-pro": { input: 3.5, output: 10.5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

/**
 * Resolves pricing rates for a model using model.cost if present,
 * falling back to default static pricing table.
 */
export function resolveModelPricing(
  model: unknown,
): ModelPricingRates | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const typed = model as { id?: unknown; cost?: unknown };

  if (typeof typed.cost === "object" && typed.cost !== null) {
    const cost = typed.cost as {
      input?: unknown;
      output?: unknown;
      cache_read?: unknown;
      cache_write?: unknown;
    };
    if (
      typeof cost.input === "number" &&
      !Number.isNaN(cost.input) &&
      typeof cost.output === "number" &&
      !Number.isNaN(cost.output)
    ) {
      return {
        input: cost.input,
        output: cost.output,
        cacheRead:
          typeof cost.cache_read === "number" ? cost.cache_read : undefined,
        cacheWrite:
          typeof cost.cache_write === "number" ? cost.cache_write : undefined,
      };
    }
  }

  if (typeof typed.id === "string") {
    const id = typed.id.toLowerCase();
    for (const [key, rates] of Object.entries(DEFAULT_MODEL_PRICING)) {
      if (id.includes(key.toLowerCase())) {
        return rates;
      }
    }
  }

  return undefined;
}

/**
 * Calculates dollar cost of token usage against rates.
 */
export function calculateDollarCost(
  usage: TokenUsage,
  rates: ModelPricingRates,
): number {
  if (usage.input < 0 || usage.output < 0) return 0;
  const inputCost = (usage.input / 1_000_000) * rates.input;
  const outputCost = (usage.output / 1_000_000) * rates.output;
  const cacheReadCost =
    usage.cacheRead && rates.cacheRead
      ? (usage.cacheRead / 1_000_000) * rates.cacheRead
      : 0;
  const cacheWriteCost =
    usage.cacheWrite && rates.cacheWrite
      ? (usage.cacheWrite / 1_000_000) * rates.cacheWrite
      : 0;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export function formatDollarCost(dollars: number): string {
  if (dollars <= 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
