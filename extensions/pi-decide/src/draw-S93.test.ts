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
    const classify = vi.fn(async (_model: unknown, _input: unknown) => ({
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

  it("S93 C02: rejects a model id without a provider slash before classifying", async () => {
    const classify = vi.fn();
    const ctx = { modelRegistry: { getModelOfType: vi.fn(), classify } };
    const result = await defaultDecide(
      ctx as never,
      "nomodel",
      {} as never,
      undefined,
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(/provider\/model-id/);
    expect(classify).not.toHaveBeenCalled();
  });

  it("S93 C03: reports a missing classifier model without throwing", async () => {
    const classify = vi.fn();
    const ctx = {
      modelRegistry: { getModelOfType: vi.fn(() => undefined), classify },
    };
    const result = await defaultDecide(
      ctx as never,
      "prov/m",
      {} as never,
      undefined,
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(/not found/);
    expect(classify).not.toHaveBeenCalled();
  });

  it("S93 C04: resolves the classifier model and forwards signal and temperature", async () => {
    const model = { id: "m" };
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "prov",
      model: "m",
      answers: {},
      stopReason: "stop",
      timestamp: Date.now(),
    }));
    const getModelOfType = vi.fn(() => model);
    const ctx = { modelRegistry: { getModelOfType, classify } };
    const signal = new AbortController().signal;
    const input = { state: { input: "x" }, questions: {} };

    await defaultDecide(ctx as never, "prov/m", input as never, signal);

    expect(getModelOfType).toHaveBeenCalledWith("classifier", "prov", "m");
    expect(classify).toHaveBeenCalledWith(model, input, {
      signal,
      temperature: 0,
    });
  });
});
