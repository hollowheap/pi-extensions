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
  return mkdtempSync(join(tmpdir(), "pi-language-tools-lsp-"));
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

  it("routes signature help, type definitions, implementations, highlights, and diagnostics", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "index.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath));
    const position = { line: 0, character: 6 };

    const signature = await client.signatureHelp(file, "typescript", position);
    expect(signature).toEqual(
      expect.objectContaining({
        signatures: [
          expect.objectContaining({
            label: "fn(x: number)",
            documentation: "Does things",
          }),
        ],
      }),
    );

    const typeDefinition = await client.typeDefinition(
      file,
      "typescript",
      position,
    );
    expect(typeDefinition).toEqual([
      expect.objectContaining({ uri: pathToFileURL(file).href }),
    ]);

    const implementation = await client.implementation(
      file,
      "typescript",
      position,
    );
    expect(implementation).toEqual([
      expect.objectContaining({ uri: pathToFileURL(file).href }),
    ]);

    expect(
      await client.documentHighlights(file, "typescript", position),
    ).toEqual([expect.objectContaining({ kind: 2 })]);

    expect(await client.diagnostics(file, "typescript")).toEqual([
      expect.objectContaining({
        severity: 2,
        message: "fake diagnostic",
        source: "fake",
      }),
    ]);
  });

  it("times out without disposing the shared client", async () => {
    const dir = root();
    const logPath = join(dir, "log.jsonl");
    const file = source(dir, "slow.ts", "const x = 1;\n");
    const client = getLspClient(options(dir, logPath, 1000));

    await expect(
      client.definition(file, "typescript", {
        line: 0,
        character: 6,
      }),
    ).rejects.toThrow(/timed out/);

    expect(client.disposed).toBe(false);
    expect(getLspClient(options(dir, logPath, 1000))).toBe(client);
  });

  it("rejects startup when the server exits before initialization", async () => {
    const dir = root();
    const file = source(dir, "index.ts", "const x = 1;\n");
    const client = getLspClient({
      name: "exit",
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      root: dir,
      timeoutMs: 500,
    });

    await expect(
      client.definition(file, "typescript", {
        line: 0,
        character: 6,
      }),
    ).rejects.toThrow(/exited|not running/);
    expect(client.disposed).toBe(true);
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

  it("evicts the least-recently-used idle client", () => {
    const firstDir = root();
    const first = getLspClient(options(firstDir, join(firstDir, "log.jsonl")));
    const secondDir = root();
    const second = getLspClient(
      options(secondDir, join(secondDir, "log.jsonl")),
    );

    expect(getLspClient(options(firstDir, join(firstDir, "log.jsonl")))).toBe(
      first,
    );

    for (let index = 0; index < 31; index += 1) {
      const dir = root();
      getLspClient(options(dir, join(dir, "log.jsonl")));
    }

    expect(first.disposed).toBe(false);
    expect(second.disposed).toBe(true);
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
