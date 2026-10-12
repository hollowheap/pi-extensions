import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const FREE_TEXT = "Other (free-text answer)";

function createMockPi() {
  return {
    registerTool: vi.fn(),
  };
}

interface QuestionTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: never,
    signal: undefined,
    onUpdate: () => void,
    ctx: never,
  ) => Promise<{ content: unknown; details: unknown }>;
}

function tool(pi: ReturnType<typeof createMockPi>): QuestionTool {
  return pi.registerTool.mock.calls[0][0];
}

function mockCtx(select?: unknown, input?: unknown) {
  return {
    ui: {
      select: vi.fn(async () => select),
      input: vi.fn(async () => input),
    },
  };
}

function ask(tool: QuestionTool, params: unknown, ctx: unknown) {
  return tool.execute(
    "call-1",
    params as never,
    undefined,
    () => {},
    ctx as never,
  );
}

describe("pi-question extension", () => {
  it("registers the question tool with the specified schema", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const registered = tool(pi);
    expect(registered.name).toBe("question");
    expect(registered.description).toBe(
      "Ask the user one question and wait for the answer. Use only when a choice cannot be decided from the code or the request.",
    );
    const schema = registered.parameters as unknown as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "options",
      "question",
    ]);
    expect(schema.required).toEqual(["question"]);
  });

  it.each([[["only"]], [["a", "b", "c", "d", "e"]]])(
    "rejects option counts outside 2..4: %j",
    async (options) => {
      const pi = createMockPi();
      extension(pi as never);
      const ctx = mockCtx();
      await expect(
        ask(tool(pi), { question: "Q?", options }, ctx),
      ).rejects.toThrow("2 to 4");
      expect(ctx.ui.select).not.toHaveBeenCalled();
    },
  );

  it("returns a free-text answer without options", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = mockCtx(undefined, "blue");
    const result = await ask(tool(pi), { question: "Color?" }, ctx);
    expect(ctx.ui.input).toHaveBeenCalledWith("Color?");
    expect(result.content).toEqual([{ type: "text", text: "blue" }]);
    expect(result.details).toEqual({ question: "Color?", answer: "blue" });
  });

  it("returns the chosen option", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = mockCtx("b");
    const result = await ask(
      tool(pi),
      { question: "Pick?", options: ["a", "b"] },
      ctx,
    );
    expect(ctx.ui.select).toHaveBeenCalledWith("Pick?", ["a", "b", FREE_TEXT]);
    expect(ctx.ui.input).not.toHaveBeenCalled();
    expect(result.content).toEqual([{ type: "text", text: "b" }]);
  });

  it("falls back to free text from the choice dialog", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = mockCtx(FREE_TEXT, "custom");
    const result = await ask(
      tool(pi),
      { question: "Pick?", options: ["a", "b"] },
      ctx,
    );
    expect(ctx.ui.input).toHaveBeenCalledWith("Pick?", "Custom answer");
    expect(result.content).toEqual([{ type: "text", text: "custom" }]);
  });

  it("caps the answer at 500 characters", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = mockCtx(undefined, "x".repeat(600));
    const result = await ask(tool(pi), { question: "Q?" }, ctx);
    expect(result.content).toEqual([{ type: "text", text: "x".repeat(500) }]);
  });

  it("fails when the user dismisses the dialog", async () => {
    const pi = createMockPi();
    extension(pi as never);
    await expect(
      ask(tool(pi), { question: "Pick?", options: ["a", "b"] }, mockCtx()),
    ).rejects.toThrow("dismissed");
    await expect(ask(tool(pi), { question: "Q?" }, mockCtx())).rejects.toThrow(
      "dismissed",
    );
  });

  it("fails without select and input dialogs", async () => {
    const pi = createMockPi();
    extension(pi as never);
    await expect(ask(tool(pi), { question: "Q?" }, { ui: {} })).rejects.toThrow(
      "interactive UI",
    );
  });
});
