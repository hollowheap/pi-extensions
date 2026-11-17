import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  type LspClientOptions,
  disposeAllLspClients,
  getLspClient,
} from "./lsp.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-lsp.mjs", import.meta.url),
);

function options(dir: string, logPath: string): LspClientOptions {
  return {
    name: "fake",
    command: process.execPath,
    args: [fixturePath, logPath],
    root: dir,
    timeoutMs: 1_000,
  };
}

afterEach(async () => {
  await disposeAllLspClients();
});

describe("S64: the stdio LSP client lazily pools one server per command/args/root", () => {
  it("reuses a pooled client for an identical key", () => {
    const firstDir = mkdtempSync(join(tmpdir(), "pi-lsp-draw-"));
    const first = getLspClient(options(firstDir, join(firstDir, "log.jsonl")));
    const secondDir = mkdtempSync(join(tmpdir(), "pi-lsp-draw-"));
    const second = getLspClient(
      options(secondDir, join(secondDir, "log.jsonl")),
    );
    const third = getLspClient(
      options(secondDir, join(secondDir, "log.jsonl")),
    );

    expect(first).not.toBe(second);
    expect(third).toBe(second);
  });
});
