import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_PDF_CHARS = 100_000;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export interface PdfText {
  text: string;
  truncated: boolean;
}

export type PdfRunner = (file: string, signal?: AbortSignal) => Promise<string>;

function runPdftotext(file: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "pdftotext",
      ["-layout", "--", file, "-"],
      { maxBuffer: MAX_PDF_CHARS * 4, timeout: 15_000, signal },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `pdf extraction failed: ${String(stderr || error.message).trim()}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function extractPdfText(
  bytes: Uint8Array,
  signal?: AbortSignal,
  runner: PdfRunner = runPdftotext,
): Promise<PdfText> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("pdf too large");
  }
  const dir = await mkdtemp(join(tmpdir(), "pi-web-pdf-"));
  const file = join(dir, "input.pdf");
  try {
    await writeFile(file, bytes, { mode: 0o600 });
    const output = (await runner(file, signal)).trim();
    return {
      text: output.slice(0, MAX_PDF_CHARS),
      truncated: output.length > MAX_PDF_CHARS,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
