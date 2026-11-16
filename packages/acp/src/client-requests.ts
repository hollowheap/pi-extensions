export const FS_TIMEOUT_MS = 10_000;

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export interface PermissionCall {
  toolCallId: string;
  title: string;
  kind: ToolKind;
}

export interface PermissionOption {
  optionId: "allow_once" | "reject_once";
  name: string;
  kind: "allow_once" | "reject_once";
}

export function permissionOptions(): PermissionOption[] {
  return [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "reject_once", name: "Reject", kind: "reject_once" },
  ];
}

export type ClientRequest = (
  method: string,
  params: unknown,
  timeoutMs?: number,
) => Promise<unknown>;

export async function withTimeout(
  work: Promise<unknown>,
  method: string,
  timeoutMs: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function requestPermissionOutcome(
  result: unknown,
): "allow_once" | "reject_once" {
  const outcome = (result as { outcome?: unknown }).outcome;
  if (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { outcome?: unknown }).outcome === "selected" &&
    ((outcome as { optionId?: unknown }).optionId === "allow_once" ||
      (outcome as { optionId?: unknown }).optionId === "reject_once")
  ) {
    return (outcome as { optionId: "allow_once" | "reject_once" }).optionId;
  }
  throw new Error("permission request was cancelled");
}

export async function requestPermission(
  client: ClientRequest,
  sessionId: string,
  toolCall: PermissionCall,
): Promise<"allow_once" | "reject_once"> {
  const result = await client("session/request_permission", {
    sessionId,
    toolCall: {
      toolCallId: toolCall.toolCallId,
      title: toolCall.title,
      kind: toolCall.kind,
    },
    options: permissionOptions(),
  });
  return requestPermissionOutcome(result);
}

export async function readClientFile(
  client: ClientRequest,
  sessionId: string,
  path: string,
): Promise<string> {
  const result = (await withTimeout(
    client("fs/read_text_file", { sessionId, path }, FS_TIMEOUT_MS),
    "fs/read_text_file",
    FS_TIMEOUT_MS,
  )) as { content?: unknown };
  if (typeof result.content !== "string") {
    throw new Error("fs/read_text_file returned no content");
  }
  return result.content;
}

export async function writeClientFile(
  client: ClientRequest,
  sessionId: string,
  path: string,
  content: string,
): Promise<void> {
  await withTimeout(
    client("fs/write_text_file", { sessionId, path, content }, FS_TIMEOUT_MS),
    "fs/write_text_file",
    FS_TIMEOUT_MS,
  );
}

export async function createClientTerminal(
  client: ClientRequest,
  sessionId: string,
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const result = (await withTimeout(
    client("terminal/create", { sessionId, command, args, cwd }, FS_TIMEOUT_MS),
    "terminal/create",
    FS_TIMEOUT_MS,
  )) as { terminalId?: unknown };
  if (typeof result.terminalId !== "string") {
    throw new Error("terminal/create returned no terminalId");
  }
  return result.terminalId;
}

export async function readClientTerminal(
  client: ClientRequest,
  sessionId: string,
  terminalId: string,
): Promise<{ output: string; exitCode?: number | null }> {
  const result = (await withTimeout(
    client("terminal/output", { sessionId, terminalId }, FS_TIMEOUT_MS),
    "terminal/output",
    FS_TIMEOUT_MS,
  )) as {
    output?: unknown;
    exitStatus?: { exitCode?: unknown } | null;
  };
  if (typeof result.output !== "string") {
    throw new Error("terminal/output returned no output");
  }
  const exitCode = result.exitStatus?.exitCode;
  return {
    output: result.output,
    exitCode: typeof exitCode === "number" ? exitCode : undefined,
  };
}

export async function releaseClientTerminal(
  client: ClientRequest,
  sessionId: string,
  terminalId: string,
): Promise<void> {
  await withTimeout(
    client("terminal/release", { sessionId, terminalId }, FS_TIMEOUT_MS),
    "terminal/release",
    FS_TIMEOUT_MS,
  );
}

export async function killClientTerminal(
  client: ClientRequest,
  sessionId: string,
  terminalId: string,
): Promise<void> {
  await withTimeout(
    client("terminal/kill", { sessionId, terminalId }, FS_TIMEOUT_MS),
    "terminal/kill",
    FS_TIMEOUT_MS,
  );
}
