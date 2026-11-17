import { describe, expect, it, vi } from "vitest";
import {
  formatModelId,
  isModelAvailable,
  resolveSubagentModel,
} from "./swap.js";

const agent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
  model: "unavailable/model",
};

describe("S113 model pre-flight swap", () => {
  it("offers available runtime models when the frontmatter model is missing", async () => {
    expect(formatModelId({ provider: "prov", id: "m" })).toBe("prov/m");
    expect(isModelAvailable("prov/m", ["prov/m"])).toBe(true);
    expect(isModelAvailable("missing/m", ["prov/m"])).toBe(false);

    const select = vi.fn(async () => "prov/available");
    const result = await resolveSubagentModel(
      agent,
      {
        model: "prov/fallback",
        modelRegistry: {
          getAvailable: () => [{ provider: "prov", id: "available" }],
        },
        ui: { select },
      },
      {},
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(result).toBe("prov/available");
  });
});
