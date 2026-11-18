import { describe, expect, it, vi } from "vitest";
import { MAX_PDF_BYTES, MAX_PDF_CHARS, extractPdfText } from "./pdf.js";

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

  it("S168 C02: runner whitespace is trimmed from the returned text", async () => {
    const runner = vi.fn(async () => "  spaced out \n");

    const result = await extractPdfText(new Uint8Array([1]), undefined, runner);

    expect(result).toEqual({ text: "spaced out", truncated: false });
  });

  it("S168 C03: an oversized byte array is rejected before the runner is called", async () => {
    const runner = vi.fn(async () => "unused");
    const bytes = new Uint8Array(MAX_PDF_BYTES + 1);

    await expect(extractPdfText(bytes, undefined, runner)).rejects.toThrow(
      "pdf too large",
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("S168 C04: runner output beyond the character cap is truncated", async () => {
    const runner = vi.fn(async () => "z".repeat(MAX_PDF_CHARS + 50));

    const result = await extractPdfText(new Uint8Array([1]), undefined, runner);

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_PDF_CHARS);
  });
});
