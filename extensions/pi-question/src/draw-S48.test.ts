import { describe, expect, it, vi } from "vitest";
import { createQuestionTool } from "./index.js";

vi.mock("./alerts.js", () => ({ alertQuestion: vi.fn() }));
vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

function mockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  };
}

describe("S48: cancelling a dialog cancels the set with no follow-up", () => {
  it("does not throw and emits no answers entry when the dialog is cancelled", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        select: vi.fn().mockResolvedValue(undefined),
        input: vi.fn(),
        custom: vi.fn(),
      },
    };

    await expect(
      tool.execute(
        "call-1",
        { prompt: "Cancel me", options: ["Option A"] },
        undefined,
        undefined,
        ctx as never,
      ),
    ).resolves.toBeDefined();
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });
});
