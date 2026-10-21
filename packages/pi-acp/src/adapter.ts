import { unlinkSync } from "node:fs";
import { type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { METHOD_NOT_FOUND } from "./acp.js";
import {
  type ClientRequest,
  type ToolKind,
  createClientTerminal,
  killClientTerminal,
  readClientFile,
  readClientTerminal,
  releaseClientTerminal,
  requestPermission,
  writeClientFile,
} from "./client-requests.js";
import type { PiRpc } from "./pi-rpc.js";
import { type SessionRecord, loadStore, saveStore } from "./sessions.js";
import {
  RequestTracker,
  attachWireHandler,
  sendWireRequest,
} from "./socket.js";

export const AGENT_MARK = "hollowheap-pi-acp";
export const ADAPTER_VERSION = "0.1.0";

export type Mode = "plan" | "ask" | "edit";
export const MODES: Mode[] = ["plan", "ask", "edit"];

export interface ClientCaps {
  fs?: { readTextFile?: boolean; writeTextFile?: boolean };
  terminal?: boolean;
}

export interface SpawnPiOptions {
  cwd: string;
  sessionFile?: string;
  socketPath: string;
  extensionPath: string;
  caps: ClientCaps;
}

export type SpawnPi = (
  opts: SpawnPiOptions,
  onEvent: (event: unknown) => void,
) => PiRpc;

interface LiveSession {
  record: SessionRecord;
  pi: PiRpc;
  mode: Mode;
  server: ReturnType<typeof createServer>;
  socketPath: string;
  sockets: Set<Socket>;
  tracker: RequestTracker;
  pendingPrompts: { resolve: (result: unknown) => void }[];
}

function latestSocket(session: LiveSession): Socket | undefined {
  let latest: Socket | undefined;
  for (const sock of session.sockets) latest = sock;
  return latest;
}

export interface AdapterDeps {
  spawnPi: SpawnPi;
  extensionPath: string;
  storePath: string;
  notify: (sessionId: string, update: unknown) => void;
  client: ClientRequest;
  log: (message: string) => void;
}

function toolKindFor(toolName: string): ToolKind {
  const base = toolName.startsWith("acp_") ? toolName.slice(4) : toolName;
  if (base === "read") return "read";
  if (base === "write" || base === "edit") return "edit";
  if (base === "bash") return "execute";
  if (base === "fd" || base === "rg" || base === "find" || base === "grep") {
    return "search";
  }
  return "other";
}

interface PromptBlock {
  type: string;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
  uri?: unknown;
  resource?: unknown;
}

function endText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (typeof result !== "object" || result === null) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const texts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      texts.push((block as { text: string }).text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function blockText(block: PromptBlock): string | undefined {
  if (block.type === "text" && typeof block.text === "string")
    return block.text;
  if (block.type === "resource_link" && typeof block.uri === "string") {
    return `[${block.uri}]`;
  }
  if (
    block.type === "resource" &&
    typeof block.resource === "object" &&
    block.resource !== null
  ) {
    const resource = block.resource as {
      uri?: unknown;
      text?: unknown;
      blob?: unknown;
    };
    if (typeof resource.text === "string") {
      return `[${String(resource.uri ?? "resource")}]\n${resource.text}`;
    }
    throw new Error("binary resource blocks are not supported");
  }
  return undefined;
}

export function rpcError(
  code: number,
  message: string,
): { code: number; message: string } {
  return { code, message };
}

export function modeOption(current: Mode): unknown {
  return {
    type: "select",
    id: "mode",
    name: "Mode",
    description: "Approval strictness for tool calls",
    category: "mode",
    currentValue: current,
    options: [
      {
        value: "plan",
        name: "Plan",
        description:
          "Reads auto-run; writes limited to artifacts/plan.md and artifacts/specs.md; bash asks",
      },
      {
        value: "ask",
        name: "Ask",
        description: "Reads auto-run; writes and bash ask",
      },
      {
        value: "edit",
        name: "Edit",
        description: "Writes auto-run; bash asks",
      },
    ],
  };
}

function isToolKind(value: unknown): value is ToolKind {
  return (
    value === "read" ||
    value === "edit" ||
    value === "delete" ||
    value === "move" ||
    value === "search" ||
    value === "execute" ||
    value === "think" ||
    value === "fetch" ||
    value === "switch_mode" ||
    value === "other"
  );
}

export class Adapter {
  private sessions = new Map<string, LiveSession>();
  private clientCaps: ClientCaps = {};
  private sessionSeq = 0;
  private toolSeq = 0;

  constructor(private deps: AdapterDeps) {}

  async handle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.initialize(
          params as {
            protocolVersion: number;
            clientCapabilities?: ClientCaps;
          },
        );
      case "session/new":
        return this.newSession(params as { cwd: string });
      case "session/list":
        return this.listSessions((params ?? {}) as { cwd?: string | null });
      case "session/load":
        return this.loadSession(params as { sessionId: string; cwd: string });
      case "session/cancel":
        return this.cancelSession(params as { sessionId: string });
      case "session/set_config_option":
        return this.setConfig(
          params as { sessionId: string; configId: string; value: unknown },
        );
      case "session/prompt":
        return this.prompt(
          params as { sessionId: string; prompt: PromptBlock[] },
        );
      default:
        throw rpcError(METHOD_NOT_FOUND, `unknown method: ${method}`);
    }
  }

  shutdown(): void {
    for (const [sessionId] of this.sessions) this.closeSession(sessionId);
  }

  private initialize(params: { clientCapabilities?: ClientCaps }): unknown {
    this.clientCaps = params.clientCapabilities ?? {};
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: {} },
      },
      agentInfo: {
        name: AGENT_MARK,
        title: "pi ACP adapter",
        version: ADAPTER_VERSION,
      },
    };
  }

  private socketPath(): string {
    this.sessionSeq += 1;
    return join(
      tmpdir(),
      `hollowheap-acp-${process.pid}-${this.sessionSeq}.sock`,
    );
  }

  private async serveSocket(session: {
    socketPath: string;
    sockets: Set<Socket>;
    tracker: RequestTracker;
  }): Promise<ReturnType<typeof createServer>> {
    const server = createServer((sock) => {
      session.sockets.add(sock);
      attachWireHandler(sock, session.tracker, (request, respond) => {
        const owner = [...this.sessions.values()].find((entry) =>
          entry.sockets.has(sock),
        );
        if (owner === undefined) {
          respond({ error: "unknown session" });
          return;
        }
        void this.handleSocket(owner, request).then(respond, (error) =>
          respond({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
      sock.on("close", () => {
        session.sockets.delete(sock);
      });
    });
    try {
      unlinkSync(session.socketPath);
    } catch {}
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(session.socketPath, () => resolve());
    });
    return server;
  }

  private async startPi(
    cwd: string,
    sessionFile: string | undefined,
    title: string,
  ): Promise<LiveSession> {
    const socketPath = this.socketPath();
    const tracker = new RequestTracker();
    const sockets = new Set<Socket>();
    const server = await this.serveSocket({ socketPath, sockets, tracker });
    const buffered: unknown[] = [];
    let sessionId: string | undefined;
    const pi = this.deps.spawnPi(
      {
        cwd,
        sessionFile,
        socketPath,
        extensionPath: this.deps.extensionPath,
        caps: this.clientCaps,
      },
      (event) => {
        if (sessionId === undefined) buffered.push(event);
        else this.piEvent(sessionId, event);
      },
    );
    if (sessionFile === undefined) {
      await pi.request("new_session");
    }
    const state = (await pi.getState()) as {
      sessionFile?: unknown;
      sessionId?: unknown;
    };
    if (
      typeof state.sessionFile !== "string" ||
      typeof state.sessionId !== "string"
    ) {
      pi.kill();
      throw rpcError(-32603, "pi did not report a session");
    }
    const record: SessionRecord = {
      sessionId: state.sessionId,
      cwd,
      piSessionFile: state.sessionFile,
      title,
      updatedAt: new Date().toISOString(),
      agent: AGENT_MARK,
    };
    const records = loadStore(this.deps.storePath).filter(
      (entry) => entry.sessionId !== record.sessionId,
    );
    records.push(record);
    saveStore(this.deps.storePath, records);
    const live: LiveSession = {
      record,
      pi,
      mode: "ask",
      server,
      socketPath,
      sockets,
      tracker,
      pendingPrompts: [],
    };
    this.sessions.set(record.sessionId, live);
    sessionId = record.sessionId;
    for (const event of buffered) this.piEvent(sessionId, event);
    return live;
  }

  private touch(record: SessionRecord): void {
    record.updatedAt = new Date().toISOString();
    const records = loadStore(this.deps.storePath).map((entry) =>
      entry.sessionId === record.sessionId ? record : entry,
    );
    saveStore(this.deps.storePath, records);
  }

  private async newSession(params: { cwd: string }): Promise<unknown> {
    if (!isAbsolute(params.cwd)) {
      throw rpcError(-32602, "session/new needs an absolute cwd");
    }
    const live = await this.startPi(params.cwd, undefined, "New session");
    return {
      sessionId: live.record.sessionId,
      configOptions: [modeOption("ask")],
    };
  }

  private listSessions(params: { cwd?: string | null }): unknown {
    const records = loadStore(this.deps.storePath).filter(
      (entry) => params.cwd == null || entry.cwd === params.cwd,
    );
    return {
      sessions: records.map((entry) => ({
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        title: entry.title,
        updatedAt: entry.updatedAt,
      })),
    };
  }

  private async loadSession(params: {
    sessionId: string;
    cwd: string;
  }): Promise<unknown> {
    const stored = loadStore(this.deps.storePath).find(
      (entry) => entry.sessionId === params.sessionId,
    );
    if (stored === undefined) {
      throw rpcError(-32602, `unknown session: ${params.sessionId}`);
    }
    if (params.cwd !== stored.cwd) {
      throw rpcError(
        -32602,
        `cwd mismatch: session is ${stored.cwd}, request is ${params.cwd}`,
      );
    }
    const live = await this.startPi(
      stored.cwd,
      stored.piSessionFile,
      stored.title,
    );
    if (live.record.sessionId !== stored.sessionId) {
      this.sessions.delete(live.record.sessionId);
      live.pi.kill();
      throw rpcError(-32603, "pi opened a different session file");
    }
    this.sessions.delete(stored.sessionId);
    this.sessions.set(stored.sessionId, { ...live, record: stored });
    await this.replayHistory(stored);
    this.touch(stored);
    return {};
  }

  private async replayHistory(stored: SessionRecord): Promise<void> {
    const history = (await this.sessions
      .get(stored.sessionId)
      ?.pi.getMessages()) as { messages?: unknown } | undefined;
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    const results = new Map<string, { content?: unknown; isError?: unknown }>();
    for (const message of messages) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { role?: unknown }).role === "toolResult" &&
        typeof (message as { toolCallId?: unknown }).toolCallId === "string"
      ) {
        const result = message as {
          toolCallId: string;
          content?: unknown;
          isError?: unknown;
        };
        results.set(result.toolCallId, {
          content: result.content,
          isError: result.isError,
        });
      }
    }
    const notify = (update: unknown) =>
      this.deps.notify(stored.sessionId, update);
    for (const message of messages) {
      if (typeof message !== "object" || message === null) continue;
      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      if (role === "user") {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as { type?: unknown }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string"
          ) {
            notify({
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: (block as { text: string }).text },
            });
          }
        }
        continue;
      }
      if (role !== "assistant") continue;
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const typed = block as { type?: unknown };
        if (
          typed.type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          notify({
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: (block as { text: string }).text,
            },
          });
          continue;
        }
        if (
          typed.type === "toolCall" &&
          typeof (block as { id?: unknown }).id === "string" &&
          typeof (block as { name?: unknown }).name === "string"
        ) {
          const call = block as { id: string; name: string };
          const result = results.get(call.id);
          notify({
            sessionUpdate: "tool_call",
            toolCallId: call.id,
            title: call.name,
            name: call.name,
            kind: toolKindFor(call.name),
            status: "in_progress",
          });
          if (result === undefined) continue;
          const failed = result.isError === true;
          const text = endText({ content: result.content });
          notify({
            sessionUpdate: "tool_call_update",
            toolCallId: call.id,
            status: failed ? "failed" : "completed",
            ...(text === undefined
              ? {}
              : {
                  content: [
                    { type: "content", content: { type: "text", text } },
                  ],
                }),
          });
        }
      }
    }
  }

  private async cancelSession(params: { sessionId: string }): Promise<unknown> {
    const live = this.sessions.get(params.sessionId);
    if (live === undefined) {
      throw rpcError(-32602, `unknown session: ${params.sessionId}`);
    }
    await live.pi.abort();
    return {};
  }

  private async setConfig(params: {
    sessionId: string;
    configId: string;
    value: unknown;
  }): Promise<unknown> {
    const live = this.sessions.get(params.sessionId);
    if (live === undefined) {
      throw rpcError(-32602, `unknown session: ${params.sessionId}`);
    }
    if (params.configId !== "mode") {
      throw rpcError(-32602, `unknown config option: ${params.configId}`);
    }
    if (
      typeof params.value !== "string" ||
      !(MODES as string[]).includes(params.value)
    ) {
      throw rpcError(
        -32602,
        `unknown mode: ${String(params.value)} (${MODES.join(", ")})`,
      );
    }
    const mode = params.value as Mode;
    live.mode = mode;
    const target = latestSocket(live);
    if (target === undefined) {
      throw rpcError(-32603, "extension not connected");
    }
    await sendWireRequest(target, live.tracker, "set-mode", { mode }, 10_000);
    return { configOptions: [modeOption(mode)] };
  }

  private async handleSocket(
    session: LiveSession,
    request: { method: string; params?: unknown },
  ): Promise<unknown> {
    const params = (request.params ?? {}) as Record<string, unknown>;
    switch (request.method) {
      case "permission": {
        const tool = params.tool;
        const target = params.target;
        const kind = params.kind;
        if (typeof tool !== "string" || typeof target !== "string") {
          throw new Error("permission needs a tool and a target");
        }
        this.toolSeq += 1;
        const decision = await requestPermission(
          this.deps.client,
          session.record.sessionId,
          {
            toolCallId: `acp-${this.toolSeq}`,
            title: `${tool} ${target}`,
            kind: isToolKind(kind) ? kind : "other",
          },
        );
        return { decision };
      }
      case "fs-read": {
        if (typeof params.path !== "string")
          throw new Error("fs-read needs a path");
        const content = await readClientFile(
          this.deps.client,
          session.record.sessionId,
          params.path,
        );
        return { content };
      }
      case "fs-write": {
        if (
          typeof params.path !== "string" ||
          typeof params.content !== "string"
        ) {
          throw new Error("fs-write needs a path and content");
        }
        await writeClientFile(
          this.deps.client,
          session.record.sessionId,
          params.path,
          params.content,
        );
        return {};
      }
      case "terminal-create": {
        if (
          typeof params.command !== "string" ||
          typeof params.cwd !== "string"
        ) {
          throw new Error("terminal-create needs a command and cwd");
        }
        const args = Array.isArray(params.args)
          ? params.args.filter((arg): arg is string => typeof arg === "string")
          : [];
        const terminalId = await createClientTerminal(
          this.deps.client,
          session.record.sessionId,
          params.command,
          args,
          params.cwd,
        );
        return { terminalId };
      }
      case "terminal-output": {
        if (typeof params.terminalId !== "string") {
          throw new Error("terminal-output needs a terminalId");
        }
        return await readClientTerminal(
          this.deps.client,
          session.record.sessionId,
          params.terminalId,
        );
      }
      case "terminal-release": {
        if (typeof params.terminalId !== "string") {
          throw new Error("terminal-release needs a terminalId");
        }
        await releaseClientTerminal(
          this.deps.client,
          session.record.sessionId,
          params.terminalId,
        );
        return {};
      }
      case "terminal-kill": {
        if (typeof params.terminalId !== "string") {
          throw new Error("terminal-kill needs a terminalId");
        }
        await killClientTerminal(
          this.deps.client,
          session.record.sessionId,
          params.terminalId,
        );
        return {};
      }
      default:
        throw new Error(`unknown socket method: ${request.method}`);
    }
  }

  piEvent(sessionId: string, event: unknown): void {
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      this.deps.log(`event for unknown session: ${sessionId}`);
      return;
    }
    if (typeof event !== "object" || event === null) return;
    const type = (event as { type?: unknown }).type;
    const notify = (update: unknown) => this.deps.notify(sessionId, update);
    switch (type) {
      case "text_delta": {
        const delta = (event as { delta?: unknown }).delta;
        if (typeof delta !== "string") return;
        notify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: delta },
        });
        return;
      }
      case "tool_execution_start": {
        const start = event as { toolCallId?: unknown; toolName?: unknown };
        if (typeof start.toolCallId !== "string") return;
        const name =
          typeof start.toolName === "string" ? start.toolName : "tool";
        notify({
          sessionUpdate: "tool_call",
          toolCallId: start.toolCallId,
          title: name,
          name,
          kind: toolKindFor(name),
          status: "in_progress",
        });
        return;
      }
      case "tool_execution_update": {
        const update = event as { toolCallId?: unknown };
        if (typeof update.toolCallId !== "string") return;
        notify({
          sessionUpdate: "tool_call_update",
          toolCallId: update.toolCallId,
          status: "in_progress",
        });
        return;
      }
      case "tool_execution_end": {
        const end = event as {
          toolCallId?: unknown;
          result?: unknown;
          isError?: unknown;
        };
        if (typeof end.toolCallId !== "string") return;
        const failed = end.isError === true;
        const text = endText(end.result);
        notify({
          sessionUpdate: "tool_call_update",
          toolCallId: end.toolCallId,
          status: failed ? "failed" : "completed",
          ...(text === undefined
            ? {}
            : {
                content: [{ type: "content", content: { type: "text", text } }],
              }),
        });
        return;
      }
      case "agent_settled": {
        const settled = event as { aborted?: unknown };
        const pending = live.pendingPrompts.shift();
        this.touch(live.record);
        if (pending === undefined) return;
        pending.resolve({
          stopReason: settled.aborted === true ? "cancelled" : "end_turn",
        });
        return;
      }
      default:
        return;
    }
  }

  private async prompt(params: {
    sessionId: string;
    prompt: PromptBlock[];
  }): Promise<unknown> {
    const live = this.sessions.get(params.sessionId);
    if (live === undefined) {
      throw rpcError(-32602, `unknown session: ${params.sessionId}`);
    }
    if (!Array.isArray(params.prompt)) {
      throw rpcError(-32602, "session/prompt needs a prompt array");
    }
    const texts: string[] = [];
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    for (const block of params.prompt) {
      if (typeof block !== "object" || block === null) {
        throw rpcError(-32602, "invalid prompt block");
      }
      const typed = block as PromptBlock;
      if (typed.type === "image") {
        if (
          typeof typed.data !== "string" ||
          typeof typed.mimeType !== "string"
        ) {
          throw rpcError(-32602, "invalid image block");
        }
        images.push({
          type: "image",
          data: typed.data,
          mimeType: typed.mimeType,
        });
        continue;
      }
      const text = blockText(typed);
      if (text === undefined) {
        throw rpcError(-32602, `unsupported prompt block: ${typed.type}`);
      }
      texts.push(text);
    }
    if (live.record.title === "New session") {
      const first = texts.find((text) => text.trim() !== "");
      if (first !== undefined) {
        live.record.title = first.trim().slice(0, 50);
      }
    }
    this.touch(live.record);
    await live.pi.prompt(
      texts.join("\n"),
      images.length > 0 ? images : undefined,
    );
    return new Promise<unknown>((resolve) => {
      live.pendingPrompts.push({ resolve });
    });
  }

  private closeSession(sessionId: string): void {
    const live = this.sessions.get(sessionId);
    if (live === undefined) return;
    this.sessions.delete(sessionId);
    live.pi.kill();
    for (const sock of live.sockets) sock.destroy();
    live.server.close();
    try {
      unlinkSync(live.socketPath);
    } catch {}
  }
}
