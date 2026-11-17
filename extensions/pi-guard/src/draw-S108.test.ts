import { describe, expect, it } from "vitest";
import {
  calculateContextBreakdown,
  formatContextBreakdown,
} from "./context.js";

describe("S108 /context token accounting", () => {
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
});
