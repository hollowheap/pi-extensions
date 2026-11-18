import { describe, expect, it, vi } from "vitest";
import extension, { createQuestionTool } from "./index.js";

describe("S45: question-format guidance is carried by codemode prompt guidelines", () => {
  it("registers no before_agent_start section and teaches codemode-only usage on the tool", () => {
    const handlers: Record<string, unknown> = {};
    const pi = {
      on: vi.fn((event: string, handler: unknown) => {
        handlers[event] = handler;
        return () => {};
      }),
      registerTool: vi.fn(),
      appendEntry: vi.fn(),
      getActiveTools: vi.fn(() => []),
      getAllTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };

    extension(pi as never);

    expect(handlers.before_agent_start).toBeUndefined();
    const tool = createQuestionTool(pi as never);
    expect(tool.exposure).toBe("codemode");
    const guide = (tool.promptGuidelines ?? []).join(" ");
    expect(guide).toContain("tools.question");
    expect(guide).toContain("codemode");
  });
});

describe("guideline shape, optional pi, and wording seams", () => {
  it("S45 C02: the tool carries exactly two string guidelines", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      appendEntry: vi.fn(),
    };
    const tool = createQuestionTool(pi as never);
    expect(tool.promptGuidelines).toHaveLength(2);
    expect(tool.promptGuidelines?.every((g) => typeof g === "string")).toBe(
      true,
    );
  });

  it("S45 C03: a tool built without pi still answers non-interactive calls", async () => {
    const tool = createQuestionTool();
    const result = (await tool.execute(
      "c1",
      { prompt: "Pick", options: ["A"] },
      undefined,
      undefined,
      { hasUI: true, mode: "print", ui: {} } as never,
    )) as { content: { text: string }[] };
    expect(result.content[0].text).toContain("requires an interactive session");
  });

  it("S45 C04: the second guideline forbids top-level tool calls", () => {
    const tool = createQuestionTool();
    const second = tool.promptGuidelines?.[1] ?? "";
    expect(second).toContain("codemode script");
    expect(second).toContain("never as a direct top-level tool");
  });
});
