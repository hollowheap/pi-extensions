import { describe, expect, it, vi } from "vitest";
import { extractPdfText } from "./pdf.js";

describe("S168 local PDF extraction", () => {
  it("returns bounded text from the local runner", async () => {
    const runner = vi.fn(async () => "Hello PDF");

    const result = await extractPdfText(
      new Uint8Array([1, 2]),
      undefined,
      runner,
    );

    expect(result).toEqual({ text: "Hello PDF", truncated: false });
    expect(runner).toHaveBeenCalledOnce();
  });
});
