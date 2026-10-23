import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  type LspClientOptions,
  disposeAllLspClients,
  getLspClient,
} from "./lsp.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-lsp.mjs", import.meta.url),
);

interface LogEntry {
  method?: string;
  [key: string]: unknown;
}

function root(): string {
  return mkdtempSync(join(tmpdir(), "pi-code-intel-lsp-"));
}

function source(dir: string, name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

function options(
  dir: string,
  logPath: string,
  timeoutMs = 1_000,
): LspClientOptions {
  return {
    name: "fake",
    command: process.execPath,
    args: [fixturePath, logPath],
    root: dir,
    timeoutMs,
  };
}

function readLog(path: string): LogEntry[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

async function waitForLog(
  path: string,
  predicate: (entries: LogEntry[]) => boolean,
  timeoutMs = 1_000,
): Promise<LogEntry[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const entries = readLog(path);
    if (predicate(entries)) return entries;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for log at ${path}`);
}

afterEach(async () => {
  await disposeAllLspClients();
});

describe("LSP client", () => {
  it("initializes over split and merged frames, opens documents, and routes definitions", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "index.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath));

    const result = await client.definition(file, "typescript", {
      line: 0,
      character: 6,
    });

    expect(result).toEqual([
      {
        uri: pathToFileURL(file).href,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 5 },
        },
      },
    ]);

    const entries = await waitForLog(logPath, (value) =>
      value.some((entry) => entry.method === "configuration-response"),
    );
    const open = entries.find((entry) => entry.method === "didOpen");
    expect(open).toMatchObject({
      version: 1,
      text: "const x = 1;\n",
    });
    const configuration = entries.find(
      (entry) => entry.method === "configuration-response",
    );
    expect(configuration?.result).toEqual([null]);
  });

  it("sends a full-text change when the file content changes", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "index.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath));

    await client.definition(file, "typescript", {
      line: 0,
      character: 6,
    });
    writeFileSync(file, "const y = 2;\n");
    await client.definition(file, "typescript", {
      line: 0,
      character: 6,
    });

    const entries = await waitForLog(logPath, (value) =>
      value.some((entry) => entry.method === "didChange"),
    );
    expect(entries.find((entry) => entry.method === "didOpen")).toMatchObject({
      version: 1,
    });
    expect(
      entries.filter((entry) => entry.method === "didChange").at(-1),
    ).toMatchObject({
      version: 2,
      text: "const y = 2;\n",
    });
  });

  it("routes references, document symbols, and workspace symbols", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "index.ts", "function hello() {}\n");
    const client = getLspClient(options(dir, logPath));

    const references = await client.references(file, "typescript", {
      line: 0,
      character: 9,
    });
    expect(references).toEqual([
      {
        uri: pathToFileURL(file).href,
        range: {
          start: { line: 3, character: 4 },
          end: { line: 3, character: 7 },
        },
      },
    ]);

    const symbols = await client.documentSymbols(file, "typescript");
    expect(symbols).toEqual([
      expect.objectContaining({
        name: "hello",
        kind: 12,
        children: [expect.objectContaining({ name: "inner", kind: 6 })],
      }),
    ]);

    const workspace = await client.workspaceSymbols("hello");
    expect(workspace).toEqual([
      expect.objectContaining({
        name: "hello",
        kind: 12,
        containerName: "mod",
      }),
    ]);
  });

  it("times out, disposes the server, and can respawn", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "slow.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath, 200));

    await expect(
      client.definition(file, "typescript", {
        line: 0,
        character: 6,
      }),
    ).rejects.toThrow(/timed out/);

    expect(client.disposed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getLspClient(options(dir, logPath, 200))).not.toBe(client);
  });

  it("rejects pending work with the server stderr on a crash", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "crash.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath));

    await expect(
      client.definition(file, "typescript", {
        line: 0,
        character: 6,
      }),
    ).rejects.toThrow(/fake lsp crash/);

    expect(client.disposed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getLspClient(options(dir, logPath))).not.toBe(client);
  });

  it("pools by command, args, and root", () => {
    const firstDir = root();
    const first = getLspClient(options(firstDir, join(firstDir, "log.jsonl")));
    const secondDir = root();
    const second = getLspClient(
      options(secondDir, join(secondDir, "log.jsonl")),
    );
    const third = getLspClient(
      options(secondDir, join(secondDir, "log.jsonl")),
    );

    expect(first).not.toBe(second);
    expect(third).toBe(second);
  });

  it("sends shutdown and exit when disposed", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "index.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath));

    await client.definition(file, "typescript", {
      line: 0,
      character: 6,
    });
    await disposeAllLspClients();

    expect(client.disposed).toBe(true);
    const entries = await waitForLog(logPath, (value) =>
      value.some((entry) => entry.method === "exit"),
    );
    expect(entries.some((entry) => entry.method === "shutdown")).toBe(true);
  });
});
