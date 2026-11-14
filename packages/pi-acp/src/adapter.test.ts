import { existsSync, mkdtempSync } from "node:fs";
import { type Socket, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Adapter, type SpawnPi, type SpawnPiOptions } from "./adapter.js";
import type { ModelDescriptorInfo, PiRpc } from "./pi-rpc.js";
import { loadStore } from "./sessions.js";
import {
  RequestTracker,
  attachWireHandler,
  sendWireRequest,
} from "./socket.js";

const FAKE_MODES = [
  { name: "plan" },
  { name: "ask" },
  { name: "edit" },
  {
    name: "autopilot",
    description: "Writes and non-dangerous bash run without asking",
  },
];

const FAKE_MODELS: ModelDescriptorInfo[] = [
  {
    provider: "opencode-go",
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
  },
  {
    provider: "opencode",
    id: "kimi-k2.6",
    name: "Kimi K2.6",
  },
  {
    provider: "anthropic",
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
  },
];

const peerSockets: Socket[] = [];

function setup(
  client: (method: string, params: unknown) => Promise<unknown> = async () => {
    throw new Error("no client");
  },
  stateOverride: Partial<{
    sessionFile: string;
    sessionId: string;
    model?: ModelDescriptorInfo;
  }> = {},
  optionsOverride: {
    models?: ModelDescriptorInfo[];
    defaultModel?: string;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "pi-acp-adapter-"));
  const storePath = join(dir, "sessions.json");
  const spawns: SpawnPiOptions[] = [];
  const prompts: { message: string; images: unknown }[][] = [];
  const aborted: string[][] = [];
  const mailbox: { messages: unknown[] } = { messages: [] };
  const state: {
    sessionFile: string;
    sessionId: string;
    model?: ModelDescriptorInfo;
  } = {
    sessionFile: join(dir, "pi-session.jsonl"),
    sessionId: "pi-1",
    ...stateOverride,
  };
  const spawnPi: SpawnPi = (opts) => {
    spawns.push(opts);
    const calls: string[] = [];
    aborted.push(calls);
    const sessionPrompts: { message: string; images: unknown }[] = [];
    prompts.push(sessionPrompts);
    // The bundled extension always connects back to the adapter, so the
    // fake stands in for it here.
    const peer = createConnection(opts.socketPath);
    peerSockets.push(peer);
    peer.on("error", () => {});
    peer.on("connect", () => {
      attachWireHandler(peer, new RequestTracker(), (request, respond) => {
        if (request.method === "get-modes") {
          respond({ modes: FAKE_MODES });
          return;
        }
        respond({ modes: FAKE_MODES, notices: [] });
      });
    });
    const fake = {
      request: async (type: string) => {
        calls.push(type);
        if (type === "new_session") return { cancelled: false };
        throw new Error(`unexpected: ${type}`);
      },
      getState: async () => ({ ...state }),
      getAvailableModels: async () => ({
        models: optionsOverride.models ?? [],
      }),
      setModel: async (provider: string, modelId: string) => {
        calls.push(`set_model:${provider}/${modelId}`);
        const found = optionsOverride.models?.find(
          (m) => m.provider === provider && m.id === modelId,
        );
        state.model = found ?? { provider, id: modelId };
        return state.model;
      },
      getMessages: async () => ({ messages: mailbox.messages }),
      abort: async () => {
        calls.push("abort");
        return {};
      },
      kill: () => {
        calls.push("kill");
      },
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
    defaultModel: optionsOverride.defaultModel,
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
  for (const sock of peerSockets.splice(0)) sock.destroy();
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
    ).resolves.toMatchObject({
      configOptions: expect.any(Array),
    });
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
    const buffered = (await adapter.handle("session/set_config_option", {
      sessionId: "pi-1",
      configId: "mode",
      value: "plan",
    })) as { configOptions: { currentValue: string }[] };
    expect(buffered.configOptions[0].currentValue).toBe("plan");
    const received: { method: string; params?: unknown }[] = [];
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
      expect(
        received.map(({ method, params }) => ({ method, params })),
      ).toEqual([{ method: "set-mode", params: { mode: "plan" } }]);
      received.length = 0;
      const result = (await adapter.handle("session/set_config_option", {
        sessionId: "pi-1",
        configId: "mode",
        value: "edit",
      })) as { configOptions: { currentValue: string }[] };
      expect(result.configOptions[0].currentValue).toBe("edit");
      expect(
        received.map(({ method, params }) => ({ method, params })),
      ).toEqual([{ method: "set-mode", params: { mode: "edit" } }]);
    } finally {
      sock.destroy();
    }
    adapter.shutdown();
  });

  it("carries the mode notice into the returned config option", async () => {
    const { adapter, spawns } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const sock = createConnection(spawns[0].socketPath);
    await new Promise<void>((resolve, reject) => {
      sock.on("connect", () => {
        attachWireHandler(sock, new RequestTracker(), (_request, respond) => {
          respond({ notices: ["edit mode: writes run without asking"] });
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
        value: "edit",
      })) as {
        configOptions: {
          description: string;
          options: { value: string; description: string }[];
        }[];
      };
      const option = result.configOptions[0];
      const edit = option.options.find((entry) => entry.value === "edit");
      expect(edit?.description).toContain(
        "edit mode: writes run without asking",
      );
      expect(option.description).toBe("Approval strictness for tool calls");
    } finally {
      sock.destroy();
    }
    adapter.shutdown();
  });

  it("offers the modes the extension reports", async () => {
    const { adapter } = setup();
    const created = (await adapter.handle("session/new", {
      cwd: "/repo",
      mcpServers: [],
    })) as {
      configOptions: { options: { value: string; description: string }[] }[];
    };
    const options = created.configOptions[0].options;
    expect(options.map((option) => option.value)).toEqual([
      "plan",
      "ask",
      "edit",
      "autopilot",
    ]);
    expect(
      options.find((option) => option.value === "autopilot")?.description,
    ).toBe("Writes and non-dangerous bash run without asking");
    expect(options.find((option) => option.value === "ask")?.description).toBe(
      "Reads auto-run; writes and bash ask",
    );
  });

  it("accepts a mode the extension registered", async () => {
    const { adapter } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const result = (await adapter.handle("session/set_config_option", {
      sessionId: "pi-1",
      configId: "mode",
      value: "autopilot",
    })) as { configOptions: { currentValue: string }[] };
    expect(result.configOptions[0].currentValue).toBe("autopilot");
  });

  it("auto-selects opencode-go model when initial model is unknown", async () => {
    const { adapter, aborted } = setup(
      async () => ({}),
      { model: { provider: "unknown", id: "" } },
      { models: FAKE_MODELS },
    );
    await adapter.handle("session/new", { cwd: "/repo" });
    expect(aborted[0]).toContain("set_model:opencode-go/deepseek-v4.1-flash");
  });

  it("auto-selects configured defaultModel if provided", async () => {
    const { adapter, aborted } = setup(
      async () => ({}),
      { model: { provider: "unknown", id: "" } },
      { models: FAKE_MODELS, defaultModel: "kimi" },
    );
    await adapter.handle("session/new", { cwd: "/repo" });
    expect(aborted[0]).toContain("set_model:opencode/kimi-k2.6");
  });

  it("supports model configuration via session/set_config_option", async () => {
    const { adapter, aborted } = setup(
      async () => ({}),
      { model: FAKE_MODELS[0] },
      { models: FAKE_MODELS },
    );
    const created = (await adapter.handle("session/new", {
      cwd: "/repo",
    })) as {
      configOptions: { id: string; currentValue: string }[];
    };
    const modelOption = created.configOptions.find((opt) => opt.id === "model");
    expect(modelOption?.currentValue).toBe("opencode-go/deepseek-v4.1-flash");

    const updated = (await adapter.handle("session/set_config_option", {
      sessionId: "pi-1",
      configId: "model",
      value: "anthropic/claude-3-5-sonnet",
    })) as { configOptions: { id: string; currentValue: string }[] };
    expect(aborted[0]).toContain("set_model:anthropic/claude-3-5-sonnet");
    const updatedModel = updated.configOptions.find(
      (opt) => opt.id === "model",
    );
    expect(updatedModel?.currentValue).toBe("anthropic/claude-3-5-sonnet");

    await expect(
      adapter.handle("session/set_config_option", {
        sessionId: "pi-1",
        configId: "model",
        value: "nonexistent",
      }),
    ).rejects.toThrow("unknown model");
  });

  it("closes the previous live session when reloading", async () => {
    const { adapter, aborted, spawns } = setup();
    await adapter.handle("session/new", { cwd: "/repo" });
    await adapter.handle("session/load", { sessionId: "pi-1", cwd: "/repo" });
    expect(spawns.length).toBe(2);
    expect(aborted[0]).toContain("kill");
  });

  it("keeps the mode across a session reload", async () => {
    const { adapter, spawns } = setup();
    await adapter.handle("session/new", { cwd: "/repo" });
    await adapter.handle("session/set_config_option", {
      sessionId: "pi-1",
      configId: "mode",
      value: "plan",
    });
    const loaded = (await adapter.handle("session/load", {
      sessionId: "pi-1",
      cwd: "/repo",
    })) as {
      configOptions: { id: string; currentValue: string }[];
    };
    expect(
      loaded.configOptions.find((opt) => opt.id === "mode")?.currentValue,
    ).toBe("plan");

    const received: { method: string; params?: unknown }[] = [];
    const sock = createConnection(spawns[1].socketPath);
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
      expect(
        received.map(({ method, params }) => ({ method, params })),
      ).toEqual([{ method: "set-mode", params: { mode: "plan" } }]);
    } finally {
      sock.destroy();
    }
    adapter.shutdown();
  });

  it("tears down the socket when startup validation fails", async () => {
    const { adapter, spawns } = setup(async () => ({}), {
      sessionId: undefined as never,
    });
    await expect(
      adapter.handle("session/new", { cwd: "/repo" }),
    ).rejects.toThrow("did not report a session");
    expect(existsSync(spawns[0].socketPath)).toBe(false);
  });
});

const openSockets: Socket[] = [];

afterEach(() => {
  for (const sock of openSockets.splice(0)) sock.destroy();
});

async function connectPeer(
  socketPath: string,
): Promise<{ tracker: RequestTracker; sock: Socket }> {
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
  return { tracker, sock };
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

  it("rejects pending client requests when the session closes", async () => {
    const env = setup(() => new Promise(() => {}));
    await env.adapter.handle("session/new", { cwd: "/repo" });
    const socketPath = env.spawns[0].socketPath;
    const { tracker, sock } = await connectPeer(socketPath);
    const pending = sendWireRequest(
      sock,
      tracker,
      "permission",
      { tool: "acp_read", target: "/x", kind: "read" },
      2000,
    );
    env.adapter.shutdown();
    await expect(pending).rejects.toThrow();
  });

  it("forwards the real tool call id to the client", async () => {
    const env = bridged((method) => {
      if (method === "session/request_permission") {
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      }
      return {};
    });
    await env.adapter.handle("session/new", { cwd: "/repo" });
    const socketPath = env.spawns[0].socketPath;
    const { tracker, sock } = await connectPeer(socketPath);
    await sendWireRequest(
      sock,
      tracker,
      "permission",
      {
        tool: "acp_read",
        target: "/x",
        kind: "read",
        toolCallId: "call-42",
      },
      2000,
    );
    const call = env.clientCalls.find(
      (entry) => entry.method === "session/request_permission",
    );
    const params = call?.params as {
      toolCall: { toolCallId: string };
    };
    expect(params.toolCall.toolCallId).toBe("call-42");
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

  it("settles a prompt answered while the dispatch is in flight", async () => {
    const { adapter } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const pending = adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    adapter.piEvent("pi-1", { type: "agent_settled", aborted: false });
    await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("rejects pending prompts when the session closes", async () => {
    const { adapter } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    const pending = adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    await tick();
    adapter.shutdown();
    await expect(pending).rejects.toThrow("session closed");
  });

  it("closes the session when the pi child exits", async () => {
    const { adapter, aborted } = setup();
    await adapter.handle("session/new", { cwd: "/repo", mcpServers: [] });
    adapter.piEvent("pi-1", { type: "proc_exit", code: 1 });
    expect(aborted.flat()).toContain("kill");
    await expect(
      adapter.handle("session/prompt", {
        sessionId: "pi-1",
        prompt: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toThrow("unknown session");
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

  it("intercepts /model command to display available models", async () => {
    const { adapter, notified, prompts } = setup(
      async () => ({}),
      { model: FAKE_MODELS[0] },
      { models: FAKE_MODELS },
    );
    await adapter.handle("session/new", { cwd: "/repo" });
    const result = await adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "/model" }],
    });
    expect(result).toEqual({ stopReason: "end_turn" });
    expect(prompts[0]).toEqual([]);
    const chunk = notified.find(
      (n) =>
        (n.update as { sessionUpdate: string }).sessionUpdate ===
        "agent_message_chunk",
    );
    const text = (chunk?.update as { content: { type: string; text: string } })
      .content.text;
    expect(text).toContain(
      "**Current Model:** `opencode-go/deepseek-v4.1-flash`",
    );
    expect(text).toContain("DeepSeek V4.1 Flash");
    expect(text).toContain("Kimi K2.6");
    expect(text).toContain("✓ (active)");
  });

  it("intercepts /model <name> to switch model", async () => {
    const { adapter, notified, prompts, aborted } = setup(
      async () => ({}),
      { model: FAKE_MODELS[0] },
      { models: FAKE_MODELS },
    );
    await adapter.handle("session/new", { cwd: "/repo" });
    const result = await adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "/model kimi" }],
    });
    expect(result).toEqual({ stopReason: "end_turn" });
    expect(prompts[0]).toEqual([]);
    expect(aborted[0]).toContain("set_model:opencode/kimi-k2.6");
    const chunk = notified.find(
      (n) =>
        (n.update as { sessionUpdate: string }).sessionUpdate ===
        "agent_message_chunk",
    );
    const text = (chunk?.update as { content: { type: string; text: string } })
      .content.text;
    expect(text).toContain(
      "Switched model to **Kimi K2.6** (`opencode/kimi-k2.6`)",
    );
  });

  it("handles /model with unknown or ambiguous names", async () => {
    const ambiguousModels: ModelDescriptorInfo[] = [
      { provider: "p1", id: "deepseek-chat", name: "DeepSeek Chat" },
      { provider: "p2", id: "deepseek-coder", name: "DeepSeek Coder" },
    ];
    const { adapter, notified, prompts } = setup(
      async () => ({}),
      { model: ambiguousModels[0] },
      { models: ambiguousModels },
    );
    await adapter.handle("session/new", { cwd: "/repo" });

    // Unknown model
    await adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "/model non-existent" }],
    });
    expect(prompts[0]).toEqual([]);
    let lastUpdate = notified[notified.length - 1].update as {
      content: { text: string };
    };
    expect(lastUpdate.content.text).toContain('Model "non-existent" not found');

    // Ambiguous model
    await adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "/model deepseek" }],
    });
    lastUpdate = notified[notified.length - 1].update as {
      content: { text: string };
    };
    expect(lastUpdate.content.text).toContain(
      'Multiple models match "deepseek"',
    );
    expect(lastUpdate.content.text).toContain("deepseek-chat");
    expect(lastUpdate.content.text).toContain("deepseek-coder");
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
    ).resolves.toMatchObject({
      configOptions: expect.any(Array),
    });
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
