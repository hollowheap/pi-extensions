import { describe, expect, it } from "vitest";
import {
  calculateContextBreakdown,
  formatContextBreakdown,
} from "../src/context.js";

describe("/context token accounting", () => {
  it("breaks session tokens into categories against the window limit", () => {
    const breakdown = calculateContextBreakdown(
      [
        {
          type: "message",
          message: { role: "user", content: "hello" },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "abcd" }],
          },
        },
      ],
      { limit: 1000 },
    );
    expect(breakdown.limit).toBe(1000);
    expect(breakdown.thinking).toBe(1);
    expect(breakdown.userInput).toBe(2);
    expect(breakdown.total).toBeGreaterThan(0);
    const report = formatContextBreakdown(breakdown);
    expect(report).toContain("Context usage");
    expect(report).toContain("Agent thinking");
  });

  it("an empty session reports zeroed categories and an unknown limit", () => {
    const breakdown = calculateContextBreakdown([]);
    expect(breakdown.total).toBe(0);
    expect(breakdown.limit).toBeUndefined();
    expect(formatContextBreakdown(breakdown)).toContain("limit unknown");
  });

  it("malformed message parts are skipped without throwing", () => {
    const breakdown = calculateContextBreakdown([
      null,
      "garbage",
      {
        type: "message",
        message: {
          role: "assistant",
          content: [null, 42, { type: "thinking", thinking: "abcd" }],
        },
      },
    ]);
    expect(breakdown.thinking).toBe(1);
    expect(breakdown.total).toBe(1);
  });

  it("tool and system sections are counted in separate categories", () => {
    const breakdown = calculateContextBreakdown([
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", name: "read", arguments: "{}" }],
        },
      },
      { type: "message", message: { role: "toolResult", content: "abcd" } },
      {
        type: "message",
        message: {
          role: "system",
          sections: { skills: "abcd", instructions: "abcdefgh" },
        },
      },
    ]);
    expect(breakdown.toolInput).toBeGreaterThan(0);
    expect(breakdown.toolOutput).toBe(1);
    expect(breakdown.skills).toBe(1);
    expect(breakdown.systemPrompt).toBe(2);
    expect(formatContextBreakdown(breakdown)).toContain("- Skills: 1 tokens");
  });
});
