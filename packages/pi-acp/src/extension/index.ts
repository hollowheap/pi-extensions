import { type Socket, createConnection } from "node:net";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { RequestTracker, attachWireHandler } from "../socket.js";
import { checkBash } from "./bash.js";
import { type ClientCaps, SOCKET_ENV, readCaps } from "./client.js";
import { loadRules } from "./loader.js";
import { MODES, type Mode, decide } from "./modes.js";
import type { Tag } from "./rules.js";
import {
  type ToolDeps,
  askPermission,
  createAcpTools,
  runPolicy,
} from "./tools.js";

const BUILTIN_TAGS: Record<string, Tag> = {
  write: "edit",
  edit: "edit",
  read: "read",
  find: "search",
  grep: "search",
  ls: "search",
  bash: "shell",
  powershell: "shell",
};

const ACP_TOOLS = new Set([
  "acp_read",
  "acp_write",
  "acp_edit",
  "acp_bash",
  "acp_fd",
  "acp_rg",
  "acp_eza",
]);

const BUILTIN_KINDS: Record<
  string,
  "read" | "edit" | "execute" | "search" | "other"
> = {
  read: "read",
  write: "edit",
  edit: "edit",
  find: "search",
  grep: "search",
  ls: "search",
  bash: "execute",
  powershell: "execute",
};

// Module state is shared across setup calls in one pi process (verified:
// the factory runs once per session bind against the same module instance).
// One adapter process serves one ACP session, so globals are correct.
let mode: Mode = "ask";
let caps: ClientCaps = {};
let sock: Socket | undefined;
let warned = false;
const tracker = new RequestTracker();

function getMode(): Mode {
  return mode;
}

function getCaps(): ClientCaps {
  return caps;
}

async function callSocket(
  method: string,
  params: unknown,
  timeoutMs?: number,
): Promise<unknown> {
  if (sock === undefined || sock.destroyed) {
    throw new Error("pi-acp: adapter not connected");
  }
  const { sendWireRequest } = await import("../socket.js");
  const result = await sendWireRequest(
    sock,
    tracker,
    method,
    params,
    timeoutMs,
  );
  if (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { error?: unknown }).error === "string"
  ) {
    throw new Error((result as { error: string }).error);
  }
  return result;
}

const toolDeps: ToolDeps = {
  getMode,
  getCaps,
  connected: () => sock !== undefined && !sock.destroyed,
  callSocket,
};

function readPathArg(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

function readCommandArg(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : "";
}

function connectAdapter(ctx: ExtensionContext): void {
  caps = readCaps();
  const socketPath = process.env[SOCKET_ENV];
  if (socketPath === undefined || socketPath === "") return;
  if (sock !== undefined) {
    tracker.rejectAll(new Error("reconnecting"));
    sock.destroy();
    sock = undefined;
  }
  const current = createConnection(socketPath);
  current.on("error", () => {
    if (!warned) {
      warned = true;
      ctx.ui.notify("pi-acp: cannot reach the adapter", "error");
    }
  });
  current.on("connect", () => {
    sock = current;
    attachWireHandler(current, tracker, (request, respond) => {
      if (
        request.method === "set-mode" &&
        typeof (request.params as { mode?: unknown })?.mode === "string" &&
        (MODES as string[]).includes((request.params as { mode: string }).mode)
      ) {
        mode = (request.params as { mode: Mode }).mode;
        respond({});
        return;
      }
      respond({ error: `unknown socket method: ${request.method}` });
    });
  });
}

export default function (pi: ExtensionAPI) {
  for (const tool of createAcpTools(toolDeps)) pi.registerTool(tool);
  pi.on("session_start", (_event, ctx) => {
    connectAdapter(ctx);
  });
  pi.on("session_shutdown", () => {
    if (sock !== undefined) {
      sock.destroy();
      sock = undefined;
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    if (ACP_TOOLS.has(event.toolName)) return undefined;
    const tag: Tag | undefined = BUILTIN_TAGS[event.toolName];
    if (tag === "shell") {
      const command = readCommandArg(event.input);
      const gate = checkBash(command, loadRules(ctx));
      const final = decide(getMode(), "shell", gate.decision, false);
      const connected = sock !== undefined && !sock.destroyed;
      if (final === "deny" || (final === "ask" && !connected)) {
        const reason =
          gate.decision === "deny"
            ? (gate.reason ?? "denied")
            : "mode denies shell";
        return {
          block: true,
          reason: `pi-acp: ${event.toolName} denied: ${reason}`,
        };
      }
      if (final === "allow") return undefined;
      try {
        await askPermission(toolDeps, event.toolName, command, "execute");
      } catch (error) {
        return {
          block: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      return undefined;
    }
    if (tag === undefined) {
      try {
        await askPermission(
          toolDeps,
          event.toolName,
          readPathArg(event.input) ?? event.toolName,
          "other",
        );
      } catch (error) {
        return {
          block: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      return undefined;
    }
    const raw = readPathArg(event.input) ?? ".";
    try {
      await runPolicy(
        toolDeps,
        ctx,
        event.toolName,
        tag,
        raw,
        BUILTIN_KINDS[event.toolName] ?? "other",
      );
    } catch (error) {
      return {
        block: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return undefined;
  });
}
