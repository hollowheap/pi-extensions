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
