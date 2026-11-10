import { describe, expect, it, vi } from "vitest";
import {
  buildObserverPrompt,
  observeConversation,
  parseObservationResponse,
} from "./observer.js";

describe("parseObservationResponse", () => {
  it("parses object and array responses with validation", () => {
    expect(
      parseObservationResponse(
        '```json\n{"observations":[{"text":"One","relevance":9},{"text":"Two"}]}\n```',
        [],
        2,
      ),
    ).toEqual([
      { text: "One", relevance: 5 },
      { text: "Two", relevance: 3 },
    ]);
    expect(
      parseObservationResponse('[{"text":"Array","relevance":2}]', [], 1),
    ).toEqual([{ text: "Array", relevance: 2 }]);
  });

  it("deduplicates existing and generated text and obeys the limit", () => {
    const text = JSON.stringify([
      { text: "Existing" },
      { text: "Existing" },
      { text: "New" },
      { text: "Extra" },
    ]);
    expect(parseObservationResponse(text, ["existing"], 1)).toEqual([
      { text: "New", relevance: 3 },
    ]);
  });

  it("returns no observations for invalid JSON or empty text", () => {
    expect(parseObservationResponse("not json", [], 5)).toEqual([]);
    expect(
      parseObservationResponse('{"observations":[{"text":" "}]}', [], 5),
    ).toEqual([]);
    expect(parseObservationResponse("[]", [], 0)).toEqual([]);
  });
});

describe("buildObserverPrompt", () => {
  it("includes existing memory and redacts secrets", () => {
    const prompt = buildObserverPrompt(
      "api_key=abcdefghijk",
      ["token: abcdefghijk"],
      true,
    );
    expect(prompt).toContain("Existing observations");
    expect(prompt).toContain("relevance");
    expect(prompt).not.toContain("abcdefghijk");
  });
});

describe("observeConversation", () => {
  it("calls the configured model and redacts generated observations", async () => {
    const complete = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"observations":[{"text":"Use token sk-abcdefghijklmnopqrstuvwxyz123456","relevance":4}]}',
        },
      ],
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 },
      },
    });
    const registry = { complete } as never;
    const model = { id: "model" } as never;
    const controller = new AbortController();

    const result = await observeConversation({
      registry,
      model,
      conversation: "api_key=abcdefghijk",
      existing: [],
      remaining: 5,
      redact: true,
      signal: controller.signal,
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.observations[0]?.text).toContain("[REDACTED]");
    expect(result.observations[0]?.text).not.toContain("abcdefghijk");
    expect(result.usage?.input).toBe(10);
    const prompt = complete.mock.calls[0]?.[1] as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    expect(prompt.messages[0]?.content[0]?.text).not.toContain("abcdefghijk");
  });

  it("throws when stopReason is error, aborted, or length with no parsed observation", async () => {
    const model = { id: "model" } as never;
    const signal = new AbortController().signal;

    await expect(
      observeConversation({
        registry: {
          complete: vi.fn().mockResolvedValue({
            content: [],
            stopReason: "error",
            errorMessage: "429 rate limited",
          }),
        } as never,
        model,
        conversation: "hello",
        existing: [],
        remaining: 5,
        redact: true,
        signal,
      }),
    ).rejects.toThrow("429 rate limited");

    await expect(
      observeConversation({
        registry: {
          complete: vi.fn().mockResolvedValue({
            content: [],
            stopReason: "aborted",
          }),
        } as never,
        model,
        conversation: "hello",
        existing: [],
        remaining: 5,
        redact: true,
        signal,
      }),
    ).rejects.toThrow("aborted");

    await expect(
      observeConversation({
        registry: {
          complete: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: '{"observations":[{"text":"cut' }],
            stopReason: "length",
          }),
        } as never,
        model,
        conversation: "hello",
        existing: [],
        remaining: 5,
        redact: true,
        signal,
      }),
    ).rejects.toThrow("length");
  });

  it("salvages completed observations from a truncated length response", async () => {
    const model = { id: "model", reasoning: true } as never;
    const signal = new AbortController().signal;

    const result = await observeConversation({
      registry: {
        complete: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: '{"observations":[{"text":"User prefers vitest","relevance":4},{"text":"Incomplete',
            },
          ],
          stopReason: "length",
        }),
      } as never,
      model,
      conversation: "hello",
      existing: [],
      remaining: 5,
      redact: true,
      signal,
    });

    expect(result.observations).toEqual([
      { text: "User prefers vitest", relevance: 4 },
    ]);
  });
});
