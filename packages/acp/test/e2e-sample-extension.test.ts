import { mkdtempSync, rmSync } from "node:fs";
import {
  type Server,
  type Socket,
  createConnection,
  createServer,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  type Terminal,
  Text,
  TuiMainScreen,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { LineSplitter, encodeMessage } from "../src/acp.js";
import {
  RequestTracker,
  attachWireHandler,
  sendWireRequest,
} from "../src/socket.js";

class MemoryTerminal implements Terminal {
  columns: number;
  rows: number;
  writes: string[] = [];
  private onResize?: () => void;

  constructor(columns = 120, rows = 30) {
    this.columns = columns;
    this.rows = rows;
  }

  start(_onInput: (data: string) => void, onResize: () => void): void {
    this.onResize = onResize;
  }

  stop(): void {
    this.onResize = undefined;
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.writes.push(data);
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  setProgramStatus(): void {}

  resize(columns: number, rows = this.rows): void {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }
}

interface AcpBridgeEvent {
  method: string;
  payload: string;
  frame: string;
}

function createSampleAcpExtension(
  socketPath: string | undefined,
  events: AcpBridgeEvent[],
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let clientSocket: Socket | undefined;
    const tracker = new RequestTracker();

    const ensureConnected = async (): Promise<Socket> => {
      if (clientSocket && !clientSocket.destroyed) return clientSocket;
      if (!socketPath) {
        throw new Error("ACP bridge socket path not configured");
      }
      clientSocket = await new Promise<Socket>((resolve, reject) => {
        const sock = createConnection(socketPath);
        sock.once("connect", () => {
          attachWireHandler(sock, tracker, () => {});
          resolve(sock);
        });
        sock.once("error", reject);
      });
      return clientSocket;
    };

    pi.on("session_shutdown", async () => {
      tracker.rejectAll(new Error("session shutdown"));
      clientSocket?.destroy();
      clientSocket = undefined;
    });

    pi.registerTool({
      name: "acp_bridge_ping",
      label: "ACP Bridge Ping",
      description: "Send a bridged message over the ACP wire socket",
      parameters: Type.Object({
        message: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params) {
        const sock = await ensureConnected();
        const response = (await sendWireRequest(sock, tracker, "bridge/echo", {
          message: params.message,
        })) as { echoed: string };
        const frame = encodeMessage({
          jsonrpc: "2.0",
          method: "bridge/echo",
          params: { echoed: response.echoed },
        });
        const event: AcpBridgeEvent = {
          method: "bridge/echo",
          payload: response.echoed,
          frame: frame.trimEnd(),
        };
        events.push(event);
        return {
          content: [{ type: "text", text: `echoed=${response.echoed}` }],
          details: event,
        };
      },
    });

    pi.registerMessageRenderer<AcpBridgeEvent>(
      "acp-bridge-event",
      (message) => {
        const details = message.details;
        const text = details
          ? `[acp] ${details.method} -> ${details.payload}`
          : String(message.content);
        const box = new Box(1, 0);
        box.addChild(new Text(text, 0, 0));
        return {
          render: (width: number) =>
            box.render(width).map((row) => truncateToWidth(row, width)),
          invalidate: () => box.invalidate(),
        };
      },
    );

    pi.registerCommand("acp-bridge-status", {
      description: "Render ACP bridge status widget",
      handler: async (_args, ctx) => {
        ctx.ui.setWidget(
          "acp-bridge",
          (): Component => ({
            render: (width: number) => {
              const header = truncateToWidth(
                `ACP Bridge (${events.length} frames)`,
                width,
              );
              const rows = events.map((entry) =>
                truncateToWidth(`• ${entry.method}: ${entry.payload}`, width),
              );
              return [header, ...rows];
            },
            invalidate: () => {},
          }),
        );
      },
    });
  };
}

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("packages/acp sample extension E2E", () => {
  it("bridges wire requests and renders ACP widget & message across 120 -> 80 -> 44 resizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-acp-e2e-"));
    tempDirs.push(root);
    const socketPath = join(root, "bridge.sock");

    const server = createServer((sock) => {
      attachWireHandler(sock, new RequestTracker(), (request, respond) => {
        if (request.method === "bridge/echo") {
          const payload = request.params as { message?: string } | undefined;
          respond({ echoed: String(payload?.message ?? "") });
          return;
        }
        throw new Error(`Unknown method: ${request.method}`);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const events: AcpBridgeEvent[] = [];
    const handlers = new Map<string, () => Promise<void>>();
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: { message: string },
        ) => Promise<{
          content: Array<{ type: string; text: string }>;
          details: AcpBridgeEvent;
        }>;
      }
    >();
    const commands = new Map<
      string,
      (args: string, ctx: never) => Promise<void>
    >();
    const renderers = new Map<
      string,
      (message: {
        customType: string;
        content: string;
        details?: AcpBridgeEvent;
      }) => Component | undefined
    >();
    const widgets = new Map<string, () => Component>();

    const mockPi = {
      on: (event: string, fn: () => Promise<void>) => {
        handlers.set(event, fn);
      },
      registerTool: (def: { name: string; execute: never }) => {
        tools.set(def.name, def as never);
      },
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: never) => Promise<void> },
      ) => {
        commands.set(name, def.handler);
      },
      registerMessageRenderer: (
        type: string,
        renderer: (message: {
          customType: string;
          content: string;
          details?: AcpBridgeEvent;
        }) => Component | undefined,
      ) => {
        renderers.set(type, renderer);
      },
    };

    createSampleAcpExtension(
      socketPath,
      events,
    )(mockPi as unknown as ExtensionAPI);

    const tool = tools.get("acp_bridge_ping");
    expect(tool).toBeDefined();

    const result = await tool?.execute("call-1", {
      message: "hello-acp-bridge-with-a-reasonably-long-payload",
    });
    expect(result?.details.payload).toBe(
      "hello-acp-bridge-with-a-reasonably-long-payload",
    );

    const splitter = new LineSplitter();
    const decoded = splitter.push(`${result?.details.frame}\n`);
    expect(decoded).toHaveLength(1);

    const ctx = {
      cwd: root,
      ui: {
        setWidget: (id: string, factoryFn: () => Component) => {
          widgets.set(id, factoryFn);
        },
      },
    };
    await commands.get("acp-bridge-status")?.("", ctx as never);

    const widget = widgets.get("acp-bridge")?.();
    const msgComponent = renderers.get("acp-bridge-event")?.({
      customType: "acp-bridge-event",
      content: "acp",
      details: result?.details,
    });
    expect(widget).toBeDefined();
    expect(msgComponent).toBeDefined();

    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();
    try {
      if (widget) tui.addChild(widget);
      if (msgComponent) tui.addChild(msgComponent);

      for (const width of [120, 80, 44]) {
        terminal.writes = [];
        terminal.resize(width, 30);
        tui.renderNow(true);
        expect(terminal.writes.length).toBeGreaterThan(0);

        const lines = tui.render(width);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    } finally {
      tui.stop();
      await handlers.get("session_shutdown")?.();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK E2E", () => {
    it("loads sample ACP extension and completes a prompt", async () => {
      const root = mkdtempSync(join(tmpdir(), "pi-acp-sdk-"));
      tempDirs.push(root);
      const agentDir = getAgentDir();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
      });
      const modelRegistry = new ModelRegistry(modelRuntime);
      const provider = process.env.PI_E2E_PROVIDER ?? "opencode-go";
      const modelId = process.env.PI_E2E_MODEL ?? "hy4-flash-free";
      const model = modelRegistry.find(provider, modelId);
      expect(model).toBeDefined();

      const events: AcpBridgeEvent[] = [];
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [createSampleAcpExtension(undefined, events)],
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: root,
        agentDir,
        model,
        modelRuntime,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        noTools: "all",
      });

      try {
        await session.prompt("Reply with exactly: OK");
        expect(session.state.messages.length).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
