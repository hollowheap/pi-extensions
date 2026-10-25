import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LineSplitter, encodeMessage, isRequest } from "./acp.js";
import { Adapter } from "./adapter.js";
import type { ClientRequest } from "./client-requests.js";
import { spawnPiRpc } from "./pi-rpc.js";

const SYSTEM_APPENDIX = `ACP session tools: prefer acp_read, acp_write, acp_edit, acp_bash, acp_fd, acp_rg, acp_eza over built-in tools with overlapping jobs.
- acp_write creates new files only and refuses existing paths.
- acp_edit replaces exact oldText matches and refuses when the editor buffer differs from disk.
- Approval modes, switched by the client, not by you: plan allows reads and allowlisted bash and writes only to artifacts/plan.md and artifacts/specs.md (those always ask); ask follows the rules and asks when unlisted; edit runs reads and writes silently and runs only allowlisted bash.
- Denied calls stay denied: do not retry them with a different tool.`;

export function storePath(): string {
  const home =
    process.env.HOLLOWHEAP_ACP_HOME ??
    join(homedir(), ".local", "share", "hollowheap-pi-acp");
  return join(home, "sessions.json");
}

export function extensionPath(): string {
  const here = fileURLToPath(import.meta.url);
  const entry = here.endsWith(".ts") ? "index.ts" : "index.js";
  return join(dirname(here), "extension", entry);
}

export async function main(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  argv: string[] = process.argv,
): Promise<void> {
  void argv;
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const write = (value: unknown) => {
    output.write(encodeMessage(value));
  };
  const client: ClientRequest = (method, params, timeoutMs) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
      }
      pending.set(id, {
        resolve: (value) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          if (timer !== undefined) clearTimeout(timer);
          reject(error);
        },
      });
      write({ jsonrpc: "2.0", id, method, params });
    });

  const adapter = new Adapter({
    spawnPi: (opts, onEvent) =>
      spawnPiRpc({
        cwd: opts.cwd,
        sessionFile: opts.sessionFile,
        socketPath: opts.socketPath,
        caps: JSON.stringify(opts.caps),
        extensionPath: opts.extensionPath,
        appendix: SYSTEM_APPENDIX,
        onEvent,
      }),
    extensionPath: extensionPath(),
    storePath: storePath(),
    notify: (sessionId, update) => {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId, update },
      });
    },
    client,
    log: (message) => process.stderr.write(`[pi-acp] ${message}\n`),
  });

  const splitter = new LineSplitter();
  const onLine = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(
        `[pi-acp] dropping malformed line: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return;
    }
    if (isRequest(message)) {
      const id = message.id;
      const method = message.method;
      void adapter.handle(method, message.params).then(
        (result) => write({ jsonrpc: "2.0", id, result }),
        (error) =>
          write({
            jsonrpc: "2.0",
            id,
            error: {
              code:
                typeof (error as { code?: unknown })?.code === "number"
                  ? (error as { code: number }).code
                  : -32603,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      );
      return;
    }
    if (
      typeof message === "object" &&
      message !== null &&
      (typeof (message as { id?: unknown }).id === "number" ||
        typeof (message as { id?: unknown }).id === "string")
    ) {
      const id = (message as { id: number | string }).id;
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      const response = message as {
        result?: unknown;
        error?: { message?: unknown };
      };
      if (response.error !== undefined) {
        entry.reject(
          new Error(
            typeof response.error?.message === "string"
              ? response.error.message
              : "client request failed",
          ),
        );
      } else {
        entry.resolve(response.result);
      }
    }
  };

  input.on("data", (chunk: Buffer) => {
    for (const line of splitter.push(chunk.toString("utf8"))) onLine(line);
  });

  const shutdown = () => {
    adapter.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.stderr.write(`[pi-acp] listening (tmp: ${tmpdir()})\n`);
}

const invokedAsMain =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  main().catch((error) => {
    process.stderr.write(
      `[pi-acp] fatal: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
