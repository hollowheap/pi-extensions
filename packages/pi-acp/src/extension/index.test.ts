import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequestTracker,
  attachWireHandler,
  sendWireRequest,
} from "../socket.js";
import extension from "./index.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: {
      on: vi.fn(),
      emit: vi.fn(),
    },
  };
}

const servers: ReturnType<typeof createServer>[] = [];
const sockets: Socket[] = [];

afterEach(() => {
  for (const sock of sockets.splice(0)) sock.destroy();
  for (const server of servers.splice(0)) server.close();
  process.env.HOLLOWHEAP_ACP_SOCKET = "";
  process.env.HOLLOWHEAP_ACP_CAPS = "";
});

function project(rulesFile: string): {
  dir: string;
  ctx: Record<string, unknown>;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-acp-ext-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  return {
    dir,
    ctx: {
      cwd: dir,
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(), setStatus: vi.fn() },
    },
  };
}

function setupExtension() {
  const pi = createMockPi();
  extension(pi as never);
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  ) as Record<string, (event: never, ctx: never) => unknown>;
  return { pi, handlers };
}

function startSession(
  handlers: Record<string, (event: never, ctx: never) => unknown>,
  ctx: unknown,
): void {
  handlers.session_start(undefined as never, ctx as never);
}

function serve(
  answer: (method: string, params: unknown) => unknown,
): Promise<{ path: string; accepted: () => Socket | undefined }> {
  const tracker = new RequestTracker();
  const path = join(mkdtempSync(join(tmpdir(), "pi-acp-ext-")), "s.sock");
  let accepted: Socket | undefined;
  return new Promise((resolve, reject) => {
    const server = createServer((sock) => {
      sockets.push(sock);
      accepted = sock;
      attachWireHandler(sock, tracker, (request, respond) => {
        respond(answer(request.method, request.params));
      });
    });
    servers.push(server);
    server.on("error", reject);
    server.listen(path, () => resolve({ path, accepted: () => accepted }));
  });
}

async function waitFor(cond: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out: ${message}`);
}

describe("bundled extension", () => {
  it("registers the seven acp tools", () => {
    const { pi } = setupExtension();
    const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual([
      "acp_read",
      "acp_write",
      "acp_edit",
      "acp_bash",
      "acp_fd",
      "acp_rg",
      "acp_eza",
    ]);
  });

  it("blocks denied builtin writes without touching the socket", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: ["deny edit *"] }));
    startSession(handlers, ctx);
    const hook = handlers.tool_call;
    const result = (await hook(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "x.ts" },
      } as never,
      ctx as never,
    )) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    expect(result.reason).toContain("denied");
  });

  it("denies an ask when no client is connected", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: [] }));
    startSession(handlers, ctx);
    const hook = handlers.tool_call;
    const result = (await hook(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "src/x.ts" },
      } as never,
      ctx as never,
    )) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    expect(result.reason).toContain("no client connected");
  });

  it("asks unknown tools through the client and honors reject", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: [] }));
    const seen: string[] = [];
    const { path, accepted } = await serve((method) => {
      seen.push(method);
      return { decision: "reject_once" };
    });
    process.env.HOLLOWHEAP_ACP_SOCKET = path;
    startSession(handlers, ctx);
    await waitFor(() => accepted() !== undefined, "connect");
    const hook = handlers.tool_call;
    const result = (await hook(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "mcp__x",
        input: {},
      } as never,
      ctx as never,
    )) as { block: boolean; reason: string };
    expect(result.block).toBe(true);
    expect(result.reason).toContain("not approved");
    expect(seen).toEqual(["permission"]);
  });

  it("reports the registered modes over get-modes", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: [] }));
    const { path, accepted } = await serve(() => ({ decision: "allow_once" }));
    process.env.HOLLOWHEAP_ACP_SOCKET = path;
    startSession(handlers, ctx);
    await waitFor(() => accepted() !== undefined, "connect");
    const serverTracker = new RequestTracker();
    const serverSock = accepted();
    if (serverSock === undefined) throw new Error("no socket");
    attachWireHandler(serverSock, serverTracker, () => {});
    const reply = (await sendWireRequest(
      serverSock,
      serverTracker,
      "get-modes",
      {},
    )) as { modes: { name: string; description?: string }[] };
    expect(reply.modes.map((mode) => mode.name)).toEqual(
      expect.arrayContaining(["ask", "edit", "plan"]),
    );
  });

  it("returns the mode notice over set-mode", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: [] }));
    const { path, accepted } = await serve(() => ({ decision: "allow_once" }));
    process.env.HOLLOWHEAP_ACP_SOCKET = path;
    startSession(handlers, ctx);
    await waitFor(() => accepted() !== undefined, "connect");
    const serverTracker = new RequestTracker();
    const serverSock = accepted();
    if (serverSock === undefined) throw new Error("no socket");
    attachWireHandler(serverSock, serverTracker, () => {});
    registerMode({
      name: "notice-mode",
      defaults: { read: "allow", search: "allow", edit: "ask", shell: "ask" },
      onEnter: () => ({ notice: { text: "notice-mode on", level: "warning" } }),
    });
    const reply = (await sendWireRequest(
      serverSock,
      serverTracker,
      "set-mode",
      {
        mode: "notice-mode",
      },
    )) as { notices: string[]; modes: { name: string }[] };
    expect(reply.notices).toEqual(["notice-mode on"]);
    expect(reply.modes.map((mode) => mode.name)).toContain("notice-mode");
  });

  it("switches mode over set-mode and enforces plan limits", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: ["allow edit *"] }));
    const { path, accepted } = await serve(() => ({ decision: "allow_once" }));
    process.env.HOLLOWHEAP_ACP_SOCKET = path;
    startSession(handlers, ctx);
    await waitFor(() => accepted() !== undefined, "connect");
    const serverTracker = new RequestTracker();
    const serverSock = accepted();
    if (serverSock === undefined) throw new Error("no socket");
    attachWireHandler(serverSock, serverTracker, () => {});
    await sendWireRequest(serverSock, serverTracker, "set-mode", {
      mode: "plan",
    });
    const hook = handlers.tool_call;
    const outside = (await hook(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "src/x.ts" },
      } as never,
      ctx as never,
    )) as { block: boolean; reason: string };
    expect(outside.block).toBe(true);
    expect(outside.reason).toContain("denied");
  });

  it("closes the socket on shutdown without failing", async () => {
    const { handlers } = setupExtension();
    const { ctx } = project(JSON.stringify({ rules: [] }));
    await serve(() => ({}));
    startSession(handlers, ctx);
    expect(() =>
      handlers.session_shutdown(undefined as never, ctx as never),
    ).not.toThrow();
  });
});
