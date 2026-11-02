import { describe, expect, it, vi } from "vitest";
import { MAX_PDF_BYTES, MAX_PDF_CHARS, extractPdfText } from "./pdf.js";

describe("PDF extraction", () => {
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

  it("marks output above the character cap as truncated", async () => {
    const runner = async () => "x".repeat(MAX_PDF_CHARS + 10);
    const result = await extractPdfText(new Uint8Array([1]), undefined, runner);
    expect(result.text).toHaveLength(MAX_PDF_CHARS);
    expect(result.truncated).toBe(true);
  });

  it("rejects oversized PDFs", async () => {
    await expect(
      extractPdfText(new Uint8Array(MAX_PDF_BYTES + 1)),
    ).rejects.toThrow(/too large/);
  });
});
