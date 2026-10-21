import { mkdtempSync } from "node:fs";
import { type Socket, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Adapter, type SpawnPi, type SpawnPiOptions } from "./adapter.js";
import type { PiRpc } from "./pi-rpc.js";
import { loadStore } from "./sessions.js";
import {
  RequestTracker,
  attachWireHandler,
  sendWireRequest,
} from "./socket.js";

function setup(
  client: (method: string, params: unknown) => Promise<unknown> = async () => {
    throw new Error("no client");
  },
) {
  const dir = mkdtempSync(join(tmpdir(), "pi-acp-adapter-"));
  const storePath = join(dir, "sessions.json");
  const spawns: SpawnPiOptions[] = [];
  const prompts: { message: string; images: unknown }[][] = [];
  const aborted: string[][] = [];
  const mailbox: { messages: unknown[] } = { messages: [] };
  const state = {
    sessionFile: join(dir, "pi-session.jsonl"),
    sessionId: "pi-1",
  };
  const spawnPi: SpawnPi = (opts) => {
    spawns.push(opts);
    const calls: string[] = [];
    aborted.push(calls);
    const sessionPrompts: { message: string; images: unknown }[] = [];
    prompts.push(sessionPrompts);
    const fake = {
      request: async (type: string) => {
        calls.push(type);
        if (type === "new_session") return { cancelled: false };
        throw new Error(`unexpected: ${type}`);
      },
      getState: async () => ({ ...state }),
      getMessages: async () => ({ messages: mailbox.messages }),
      abort: async () => {
        calls.push("abort");
        return {};
      },
      kill: () => {},
      prompt: async (message: string, images?: unknown) => {
        calls.push("prompt");
        sessionPrompts.push({ message, images });
      },
    };
    return fake as unknown as PiRpc;
  };
  const notified: { sessionId: string; update: unknown }[] = [];
  const adapter = new Adapter({
    spawnPi,
    extensionPath: "/ext/index.ts",
    storePath,
    notify: (sessionId, update) => notified.push({ sessionId, update }),
    client,
    log: () => {},
  });
  live.push(adapter);
  return {
    dir,
    storePath,
    spawns,
    aborted,
    prompts,
    mailbox,
    adapter,
    notified,
    state,
  };
}

const live: { shutdown: () => void }[] = [];

afterEach(() => {
  for (const entry of live.splice(0)) entry.shutdown();
});

describe("adapter sessions", () => {
  it("negotiates initialize and stores client caps", async () => {
    const { adapter } = setup();
    const result = (await adapter.handle("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true }, terminal: true },
    })) as { protocolVersion: number; agentCapabilities: unknown };
    expect(result.protocolVersion).toBe(1);
    expect(result.agentCapabilities).toEqual({
      loadSession: true,
      sessionCapabilities: { list: {} },
    });
  });

  it("rejects unknown methods", async () => {
    const { adapter } = setup();
    await expect(adapter.handle("nope", {})).rejects.toMatchObject({
      code: -32601,
    });
  });

  it("creates sessions with a pi process and store record", async () => {
    const { adapter, spawns, storePath } = setup();
    const result = (await adapter.handle("session/new", {
      cwd: "/repo",
      mcpServers: [],
    })) as { sessionId: string; configOptions: unknown[] };
    expect(result.sessionId).toBe("pi-1");
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({
      cwd: "/repo",
      extensionPath: "/ext/index.ts",
    });
    expect(spawns[0].socketPath).toContain("hollowheap-acp-");
    expect(spawns[0].sessionFile).toBeUndefined();
    const records = loadStore(storePath);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sessionId: "pi-1",
      cwd: "/repo",
      agent: "hollowheap-pi-acp",
    });
    expect(result.configOptions).toHaveLength(1);
  });

  it("rejects relative cwd on session/new", async () => {
    const { adapter, spawns } = setup();
    await expect(
      adapter.handle("session/new", { cwd: "rel", mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(spawns).toHaveLength(0);
  });

  it("lists sessions filtered by cwd", async () => {
    const { adapter } = setup();
    await adapter.handle("session/new", { cwd: "/a", mcpServers: [] });
    const all = (await adapter.handle("session/list", {})) as {
      sessions: unknown[];
    };
    expect(all.sessions).toHaveLength(1);
    const filtered = (await adapter.handle("session/list", {
      cwd: "/elsewhere",
    })) as { sessions: unknown[] };
    expect(filtered.sessions).toHaveLength(0);
  });

  it("loads sessions by id with the cwd check", async () => {
    const { adapter, spawns } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    await expect(
      adapter.handle("session/load", {
        sessionId: "missing",
        cwd: "/repo",
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      adapter.handle("session/load", {
        sessionId: "pi-1",
        cwd: "/other",
        mcpServers: [],
      }),
    ).rejects.toThrow("cwd mismatch");
    await expect(
      adapter.handle("session/load", {
        sessionId: "pi-1",
        cwd: "/repo",
        mcpServers: [],
      }),
    ).resolves.toEqual({});
    expect(spawns[spawns.length - 1].sessionFile).toContain("pi-session.jsonl");
  });

  it("cancels live sessions through pi abort", async () => {
    const { adapter, aborted } = setup();
    await expect(
      adapter.handle("session/cancel", { sessionId: "nope" }),
    ).rejects.toMatchObject({ code: -32602 });
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    await expect(
      adapter.handle("session/cancel", { sessionId: "pi-1" }),
    ).resolves.toEqual({});
    expect(aborted.flat()).toContain("abort");
  });

  it("validates set_config and forwards the mode over the socket", async () => {
    const { adapter, spawns } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    await expect(
      adapter.handle("session/set_config_option", {
        sessionId: "pi-1",
        configId: "model",
        value: "x",
      }),
    ).rejects.toThrow("unknown config option");
    await expect(
      adapter.handle("session/set_config_option", {
        sessionId: "pi-1",
        configId: "mode",
        value: "turbo",
      }),
    ).rejects.toThrow("unknown mode");
    await expect(
      adapter.handle("session/set_config_option", {
        sessionId: "pi-1",
        configId: "mode",
        value: "plan",
      }),
    ).rejects.toThrow("extension not connected");
    const received: unknown[] = [];
    const sock = createConnection(spawns[0].socketPath);
    await new Promise<void>((resolve, reject) => {
      sock.on("connect", () => {
        attachWireHandler(sock, new RequestTracker(), (request, respond) => {
          received.push(request);
          respond({ ok: true });
        });
        resolve();
      });
      sock.on("error", reject);
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = (await adapter.handle("session/set_config_option", {
        sessionId: "pi-1",
        configId: "mode",
        value: "plan",
      })) as { configOptions: { currentValue: string }[] };
      expect(result.configOptions[0].currentValue).toBe("plan");
      expect(received).toEqual([
        { id: 1, method: "set-mode", params: { mode: "plan" } },
      ]);
    } finally {
      sock.destroy();
    }
    adapter.shutdown();
  });
});

const openSockets: Socket[] = [];

afterEach(() => {
  for (const sock of openSockets.splice(0)) sock.destroy();
});

async function connectPeer(
  socketPath: string,
): Promise<{ tracker: RequestTracker }> {
  const tracker = new RequestTracker();
  const sock = createConnection(socketPath);
  openSockets.push(sock);
  await new Promise<void>((resolve, reject) => {
    sock.on("connect", () => {
      attachWireHandler(sock, tracker, () => {});
      resolve();
    });
    sock.on("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { tracker };
}

function peerRequest(
  socketPath: string,
  tracker: RequestTracker,
  method: string,
  params: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    openSockets.push(sock);
    sock.on("connect", () => {
      attachWireHandler(sock, tracker, () => {});
      sendWireRequest(sock, tracker, method, params, 2000).then(
        resolve,
        reject,
      );
    });
    sock.on("error", reject);
  });
}

describe("socket bridge", () => {
  function bridged(
    handler: (method: string, params: unknown) => unknown,
  ): ReturnType<typeof setup> & {
    clientCalls: { method: string; params: unknown }[];
  } {
    const clientCalls: { method: string; params: unknown }[] = [];
    const env = setup(async (method: string, params: unknown) => {
      clientCalls.push({ method, params });
      return handler(method, params);
    });
    return { ...env, clientCalls };
  }

  it("answers permission, fs, and terminal through the client", async () => {
    const env = bridged((method) => {
      if (method === "session/request_permission") {
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      }
      if (method === "fs/read_text_file") return { content: "data" };
      if (method === "terminal/create") return { terminalId: "t1" };
      if (method === "terminal/output")
        return { output: "out", exitStatus: { exitCode: 0 } };
      return {};
    });
    await env.adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const socketPath = env.spawns[0].socketPath;
    const { tracker } = await connectPeer(socketPath);
    await expect(
      peerRequest(socketPath, tracker, "permission", {
        tool: "acp_read",
        target: "/x",
        kind: "read",
      }),
    ).resolves.toEqual({ decision: "allow_once" });
    await expect(
      peerRequest(socketPath, tracker, "fs-read", { path: "/x" }),
    ).resolves.toEqual({ content: "data" });
    await expect(
      peerRequest(socketPath, tracker, "terminal-create", {
        command: "ls",
        args: [],
        cwd: "/repo",
      }),
    ).resolves.toEqual({ terminalId: "t1" });
    await expect(peerRequest(socketPath, tracker, "nope", {})).resolves.toEqual(
      { error: "unknown socket method: nope" },
    );
    const methods = env.clientCalls.map((call) => call.method);
    expect(methods).toEqual([
      "session/request_permission",
      "fs/read_text_file",
      "terminal/create",
    ]);
  });
});

describe("prompt turns", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("sends text to pi and settles on agent_settled", async () => {
    const { adapter, notified, prompts } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const pending = adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    await tick();
    expect(prompts[0]).toEqual([{ message: "hello", images: undefined }]);
    adapter.piEvent("pi-1", { type: "text_delta", delta: "hi" });
    expect(notified).toEqual([
      {
        sessionId: "pi-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        },
      },
    ]);
    adapter.piEvent("pi-1", { type: "agent_settled", aborted: false });
    await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("reports cancelled when aborted", async () => {
    const { adapter } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const pending = adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    await tick();
    adapter.piEvent("pi-1", { type: "agent_settled", aborted: true });
    await expect(pending).resolves.toEqual({ stopReason: "cancelled" });
  });

  it("maps tool execution to call updates", async () => {
    const { adapter, notified } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const pending = adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "go" }],
    });
    await tick();
    adapter.piEvent("pi-1", {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "acp_read",
      args: {},
    });
    adapter.piEvent("pi-1", {
      type: "tool_execution_update",
      toolCallId: "c1",
      toolName: "acp_read",
      args: {},
      partialResult: null,
    });
    adapter.piEvent("pi-1", {
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "acp_read",
      result: { content: [{ type: "text", text: "data" }] },
      isError: false,
    });
    adapter.piEvent("pi-1", { type: "agent_settled", aborted: false });
    await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
    expect(notified.map((entry) => entry.update)).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "acp_read",
        name: "acp_read",
        kind: "read",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "data" } }],
      },
    ]);
  });

  it("titles sessions from the first prompt and rejects bad blocks", async () => {
    const { adapter, storePath } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const pending = adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [
        { type: "text", text: "do the thing please" },
        { type: "resource_link", uri: "file:///repo/a" },
      ],
    });
    await tick();
    adapter.piEvent("pi-1", { type: "agent_settled", aborted: false });
    await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
    const { loadStore } = await import("./sessions.js");
    expect(loadStore(storePath)[0].title).toBe("do the thing please");
    await expect(
      adapter.handle("session/prompt", {
        sessionId: "pi-1",
        prompt: [{ type: "audio", data: "x" }],
      }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      adapter.handle("session/prompt", {
        sessionId: "nope",
        prompt: [{ type: "text", text: "hi" }],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});

describe("session/load replay", () => {
  it("replays user, assistant, and tool history as updates", async () => {
    const { adapter, notified, mailbox } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    mailbox.messages = [
      { role: "system", content: "", timestamp: 1 },
      {
        role: "user",
        content: [{ type: "text", text: "fix it" }],
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "on it" },
          { type: "toolCall", id: "c1", name: "acp_read", arguments: {} },
          { type: "toolCall", id: "c2", name: "acp_bash", arguments: {} },
          { type: "toolCall", id: "c3", name: "acp_fd", arguments: {} },
        ],
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "acp_read",
        content: [{ type: "text", text: "file!" }],
        isError: false,
        timestamp: 4,
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "acp_bash",
        content: [{ type: "text", text: "boom" }],
        isError: true,
        timestamp: 5,
      },
    ];
    notified.splice(0);
    await expect(
      adapter.handle("session/load", {
        sessionId: "pi-1",
        cwd: "/repo",
        mcpServers: [],
      }),
    ).resolves.toEqual({});
    expect(notified.map((entry) => entry.update)).toEqual([
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "fix it" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "on it" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "acp_read",
        name: "acp_read",
        kind: "read",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "file!" } },
        ],
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "c2",
        title: "acp_bash",
        name: "acp_bash",
        kind: "execute",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c2",
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: "boom" } }],
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "c3",
        title: "acp_fd",
        name: "acp_fd",
        kind: "search",
        status: "in_progress",
      },
    ]);
  });
});
