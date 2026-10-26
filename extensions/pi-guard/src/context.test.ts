import { describe, expect, it } from "vitest";
import {
  calculateContextBreakdown,
  formatContextBreakdown,
} from "./context.js";
import guardExtension from "./index.js";

describe("context breakdown calculation", () => {
  it("calculates zero tokens for empty session without options", () => {
    const result = calculateContextBreakdown([]);
    expect(result).toEqual({
      thinking: 0,
      agentOutput: 0,
      userInput: 0,
      toolOutput: 0,
      toolInput: 0,
      systemPrompt: 0,
      skills: 0,
      total: 0,
    });
    expect(result.limit).toBeUndefined();
    expect(formatContextBreakdown(result)).toContain("limit unknown");
    expect(formatContextBreakdown(result)).toContain(
      "- Agent thinking: 0 tokens",
    );
  });

  it("categorizes session messages across all seven buckets", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "system",
          sections: {
            rules: "Some system rules here.",
            skill_test: "Skill prompt instructions.",
          },
        },
      },
      {
        type: "message",
        message: {
          role: "user",
          content: "Hello assistant!",
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Thinking through the user request.",
            },
            {
              type: "toolCall",
              name: "read_file",
              arguments: { path: "foo.txt" },
            },
            { type: "text", text: "I will read the file." },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          content: "file content lines",
        },
      },
    ];

    const result = calculateContextBreakdown(entries, {
      limit: 100_000,
    });

    expect(result.thinking).toBeGreaterThan(0);
    expect(result.agentOutput).toBeGreaterThan(0);
    expect(result.userInput).toBeGreaterThan(0);
    expect(result.toolOutput).toBeGreaterThan(0);
    expect(result.toolInput).toBeGreaterThan(0);
    expect(result.systemPrompt).toBeGreaterThan(0);
    expect(result.skills).toBeGreaterThan(0);
    expect(result.total).toBe(
      result.thinking +
        result.agentOutput +
        result.userInput +
        result.toolOutput +
        result.toolInput +
        result.systemPrompt +
        result.skills,
    );
    expect(result.limit).toBe(100_000);

    const formatted = formatContextBreakdown(result);
    expect(formatted).toContain("Context usage:");
    expect(formatted).toContain("/ 100,000 tokens");
    expect(formatted).toContain("- Agent thinking:");
    expect(formatted).toContain("- Agent output:");
    expect(formatted).toContain("- User input:");
    expect(formatted).toContain("- Tool output:");
    expect(formatted).toContain("- Tool input:");
    expect(formatted).toContain("- System prompt:");
    expect(formatted).toContain("- Skills:");
  });

  it("handles malformed entries gracefully without throwing", () => {
    const malformed = [
      null,
      undefined,
      "not an object",
      {},
      { type: "message", message: null },
      {
        type: "message",
        message: { role: "assistant", content: [null, { type: "unknown" }] },
      },
    ];

    expect(() => calculateContextBreakdown(malformed as never)).not.toThrow();
    const result = calculateContextBreakdown(malformed as never);
    expect(result.total).toBe(0);
  });
});

describe("/context command in pi-guard", () => {
  it("registers /context command and outputs breakdown via ctx.ui.notify", async () => {
    const commands: Record<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    > = {};
    const mockPi = {
      events: { on: () => {}, emit: () => {} },
      on: () => () => {},
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: unknown) => Promise<void> },
      ) => {
        commands[name] = def;
      },
      registerShortcut: () => {},
    };

    guardExtension(mockPi as never);

    expect(commands.context).toBeDefined();

    const notify = (msg: string) => messages.push(msg);
    const messages: string[] = [];
    const ctx = {
      hasUI: true,
      ui: { notify },
      model: { contextWindow: 200_000 },
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: { role: "user", content: "test user input" },
          },
        ],
      },
    };

    await commands.context.handler("", ctx);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Context usage:");
    expect(messages[0]).toContain("/ 200,000 tokens");
    expect(messages[0]).toContain("- User input:");
  });
});
