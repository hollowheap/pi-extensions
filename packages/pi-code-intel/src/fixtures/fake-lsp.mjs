import { appendFileSync } from "node:fs";

const logPath = process.argv[2];
if (!logPath) {
  process.stderr.write("fake-lsp: missing log path\n");
  process.exit(2);
}

function log(entry) {
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

let writeQueue = Promise.resolve();

function sendFrames(messages) {
  const frame = Buffer.concat(messages.map(encode));
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve) => {
        const middle = Math.floor(frame.length / 2);
        process.stdout.write(frame.subarray(0, middle));
        setTimeout(() => {
          process.stdout.write(frame.subarray(middle));
          resolve();
        }, 2);
      }),
  );
}

function respond(id, result) {
  sendFrames([{ jsonrpc: "2.0", id, result }]);
}

function respondError(id, message) {
  sendFrames([{ jsonrpc: "2.0", id, error: { code: -32603, message } }]);
}

const sources = new Map();

function documentUri(params) {
  return params?.textDocument?.uri ?? "";
}

function handle(message) {
  if (message.method === undefined && message.id !== undefined) {
    log({
      method: "configuration-response",
      id: message.id,
      result: message.result,
    });
    return;
  }

  if (message.method === "initialize") {
    log({ method: "initialize" });
    respond(message.id, {
      capabilities: {
        definitionProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
      },
    });
    sendFrames([
      {
        jsonrpc: "2.0",
        id: 900,
        method: "workspace/configuration",
        params: { items: [{ section: "fake" }] },
      },
    ]);
    return;
  }

  if (message.method === "initialized") {
    log({ method: "initialized" });
    return;
  }

  if (message.method === "textDocument/didOpen") {
    const document = message.params.textDocument;
    sources.set(document.uri, document.text);
    log({
      method: "didOpen",
      uri: document.uri,
      version: document.version,
      text: document.text,
    });
    return;
  }

  if (message.method === "textDocument/didChange") {
    const document = message.params.textDocument;
    const text = message.params.contentChanges[0]?.text ?? "";
    sources.set(document.uri, text);
    log({
      method: "didChange",
      uri: document.uri,
      version: document.version,
      text,
    });
    return;
  }

  if (message.method === "textDocument/definition") {
    const uri = documentUri(message.params);
    if (uri.includes("crash")) {
      process.stderr.write("fake lsp crash\n");
      process.exit(3);
    }
    if (uri.includes("slow")) {
      setTimeout(
        () =>
          respond(message.id, [
            {
              uri,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ]),
        300,
      );
      return;
    }
    respond(message.id, [
      {
        uri,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 5 },
        },
      },
    ]);
    return;
  }

  if (message.method === "textDocument/references") {
    const uri = documentUri(message.params);
    respond(message.id, [
      {
        uri,
        range: {
          start: { line: 3, character: 4 },
          end: { line: 3, character: 7 },
        },
      },
    ]);
    return;
  }

  if (message.method === "textDocument/documentSymbol") {
    const uri = documentUri(message.params);
    respond(message.id, [
      {
        name: "hello",
        kind: 12,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        selectionRange: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 9 },
        },
        children: [
          {
            name: "inner",
            kind: 6,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 9 },
            },
            selectionRange: {
              start: { line: 0, character: 4 },
              end: { line: 0, character: 9 },
            },
          },
        ],
      },
    ]);
    log({ method: "documentSymbol", uri });
    return;
  }

  if (message.method === "workspace/symbol") {
    respond(message.id, [
      {
        name: "hello",
        kind: 12,
        location: {
          uri: "file:///tmp/hello.ts",
          range: {
            start: { line: 2, character: 3 },
            end: { line: 2, character: 8 },
          },
        },
        containerName: "mod",
      },
    ]);
    log({ method: "workspaceSymbol", query: message.params.query });
    return;
  }

  if (message.method === "shutdown") {
    log({ method: "shutdown" });
    respond(message.id, null);
    return;
  }

  if (message.method === "exit") {
    log({ method: "exit" });
    process.exit(0);
  }

  if (message.id !== undefined) {
    respondError(message.id, `fake lsp: unknown method ${message.method}`);
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (match === null) {
      process.stderr.write("fake-lsp: missing content-length\n");
      process.exit(2);
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer
      .subarray(bodyStart, bodyStart + length)
      .toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    try {
      handle(JSON.parse(body));
    } catch (error) {
      process.stderr.write(`fake-lsp: ${String(error)}\n`);
      process.exit(2);
    }
  }
});
