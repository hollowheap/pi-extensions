import { deliverAlert } from "@hollowheap/core/alerts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQuestionTool } from "../src/index.js";

vi.mock("@hollowheap/core/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hollowheap/core/alerts")>()),
  deliverAlert: vi.fn(),
}));

const deliver = vi.mocked(deliverAlert);
const payload = { event: "question", status: "asked" };

async function askQuestion() {
  return createQuestionTool().execute(
    "call",
    { prompt: "Choose a private option", options: ["Secret A", "Secret B"] },
    undefined,
    undefined,
    {
      hasUI: true,
      mode: "rpc",
      ui: { select: async () => "Secret A" },
    } as never,
  );
}

beforeEach(() => {
  deliver.mockReset().mockResolvedValue("native");
});

describe("question alerts", () => {
  it("delivers one alert whose payload contains only event and status", async () => {
    await askQuestion();

    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("a throwing notifier never blocks the question dialog", async () => {
    deliver.mockRejectedValueOnce(new Error("notification failed"));

    const result = await askQuestion();

    expect(result.details).toMatchObject({ cancelled: false });
    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("separate question alerts are not deduplicated at this seam", async () => {
    await askQuestion();
    await askQuestion();

    expect(deliver.mock.calls).toEqual([[payload], [payload]]);
  });
});
