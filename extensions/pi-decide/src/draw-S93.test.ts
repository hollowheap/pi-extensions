import { describe, expect, it, vi } from "vitest";
import { defaultDecide } from "./decide.js";

describe("S93 classifier payload construction", () => {
  it("sends only the caller-supplied state and questions to classify", async () => {
    const input = {
      state: { input: "caller input" },
      questions: {
        answer: {
          type: "bool",
          instructions: "Is this ok?",
          criteria: { true: "yes", false: "no" },
        },
      },
    };
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "prov",
      model: "m",
      answers: {},
      stopReason: "stop",
      timestamp: Date.now(),
    }));
    const ctx = {
      modelRegistry: {
        getModelOfType: vi.fn(() => ({ id: "m" })),
        classify,
      },
    };

    await defaultDecide(ctx as never, "prov/m", input as never, undefined);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][1]).toBe(input);
    expect(Object.keys(input)).toEqual(["state", "questions"]);
  });
});
