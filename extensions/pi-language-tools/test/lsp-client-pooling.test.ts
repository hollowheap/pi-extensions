import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  type LspClientOptions,
  disposeAllLspClients,
  getLspClient,
  listLspStatus,
} from "../src/lsp.js";

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

describe("the stdio LSP client lazily pools one server per command/args/root", () => {
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

  it("disposes pooled clients so the next request creates a fresh one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lsp-draw-"));
    const opts = options(dir, join(dir, "log.jsonl"));
    const first = getLspClient(opts);
    expect(getLspClient(opts)).toBe(first);
    await disposeAllLspClients();
    expect(listLspStatus()).toHaveLength(0);
    const second = getLspClient(opts);
    expect(second).not.toBe(first);
  });

  it("reports pooled clients through status and filters by root", () => {
    const firstDir = mkdtempSync(join(tmpdir(), "pi-lsp-draw-"));
    const secondDir = mkdtempSync(join(tmpdir(), "pi-lsp-draw-"));
    getLspClient(options(firstDir, join(firstDir, "log.jsonl")));
    getLspClient(options(secondDir, join(secondDir, "log.jsonl")));
    expect(listLspStatus()).toHaveLength(2);
    const filtered = listLspStatus(undefined, secondDir);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ name: "fake", status: "running" });
  });

  it("distinguishes pool entries by arguments as well as root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lsp-draw-"));
    const first = getLspClient(options(dir, join(dir, "one.jsonl")));
    const second = getLspClient(options(dir, join(dir, "two.jsonl")));
    expect(first).not.toBe(second);
    expect(listLspStatus()).toHaveLength(2);
  });
});
