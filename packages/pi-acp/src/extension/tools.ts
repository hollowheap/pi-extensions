import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import {
  type Tag,
  checkPath,
  clampMaxResults,
  displayPath,
  displayTarget,
  evaluate,
  runBinary,
  truncateText,
} from "@hollowheap/core";
import type { ClientCaps } from "./client.js";
import { loadPermissions } from "./permissions.js";

export const REQUEST_TIMEOUT_MS = 10_000;
export const TERMINAL_TIMEOUT_MS = 60_000;

export interface ToolDeps {
  getCaps: () => ClientCaps;
  connected: () => boolean;
  callSocket: (
    method: string,
    params: unknown,
    timeoutMs?: number,
  ) => Promise<unknown>;
}

export function hasConflictMarkers(content: string): boolean {
  return content
    .split("\n")
    .some(
      (line) =>
        line.startsWith("<<<<<<<") ||
        line.startsWith("=======") ||
        line.startsWith(">>>>>>>"),
    );
}

export interface TextEdit {
  oldText: string;
  newText: string;
}

export function applyEdits(original: string, edits: TextEdit[]): string {
  const ranges: { index: number; oldText: string; newText: string }[] = [];
  for (const edit of edits) {
    const index = original.indexOf(edit.oldText);
    if (index < 0) throw new Error("oldText not found");
    if (index !== original.lastIndexOf(edit.oldText)) {
      throw new Error("oldText is not unique");
    }
    ranges.push({ index, oldText: edit.oldText, newText: edit.newText });
  }
  ranges.sort((a, b) => a.index - b.index);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].index < ranges[i - 1].index + ranges[i - 1].oldText.length) {
      throw new Error("edits overlap");
    }
  }
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += original.slice(cursor, range.index) + range.newText;
    cursor = range.index + range.oldText.length;
  }
  return result + original.slice(cursor);
}

function resolveAbs(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function readLocal(path: string): string {
  return readFileSync(path, "utf8");
}

function existsLocal(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function askPermission(
  deps: ToolDeps,
  tool: string,
  target: string,
  kind: "read" | "edit" | "execute" | "search" | "other",
  toolCallId?: string,
): Promise<void> {
  const result = (await deps.callSocket("permission", {
    tool,
    target: displayTarget(target),
    kind,
    ...(toolCallId === undefined ? {} : { toolCallId }),
  })) as { decision?: unknown };
  if (result.decision !== "allow_once") {
    throw new Error(
      `pi-acp: ${tool} ${displayTarget(target)} was not approved`,
    );
  }
}

export async function runPolicy(
  deps: ToolDeps,
  ctx: ExtensionContext,
  tool: string,
  tag: Tag,
  absPath: string,
  kind: "read" | "edit" | "execute" | "search" | "other",
  toolCallId?: string,
): Promise<void> {
  const verdict = evaluate({
    owner: ctx.sessionManager,
    cwd: ctx.cwd,
    tag,
    target: absPath,
    rules: loadPermissions(ctx),
  });
  if (verdict === "deny") {
    throw new Error(
      `pi-acp: ${tag} access to ${displayTarget(absPath)} is denied`,
    );
  }
  if (verdict === "ask") {
    if (!deps.connected()) {
      throw new Error(
        `pi-acp: ${tool} ${displayTarget(absPath)} was not approved (no client connected)`,
      );
    }
    await askPermission(deps, tool, absPath, kind, toolCallId);
  }
}

async function readThroughClient(
  deps: ToolDeps,
  absPath: string,
): Promise<string> {
  const result = (await deps.callSocket(
    "fs-read",
    { path: absPath },
    REQUEST_TIMEOUT_MS,
  )) as { content?: unknown };
  if (typeof result.content !== "string") {
    throw new Error("fs-read returned no content");
  }
  return result.content;
}

async function writeThroughClient(
  deps: ToolDeps,
  absPath: string,
  content: string,
): Promise<void> {
  await deps.callSocket(
    "fs-write",
    { path: absPath, content },
    REQUEST_TIMEOUT_MS,
  );
}

function localBash(
  command: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "bash",
      ["-c", command],
      { cwd, timeout: 30000, signal },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise(stdout);
          return;
        }
        reject(
          new Error(
            `command failed: ${String(stderr || error.message).trim()}`,
          ),
        );
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTerminal(
  deps: ToolDeps,
  command: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const created = (await deps.callSocket(
    "terminal-create",
    { command: "bash", args: ["-c", command], cwd },
    REQUEST_TIMEOUT_MS,
  )) as { terminalId?: unknown };
  if (typeof created.terminalId !== "string") {
    throw new Error("terminal-create returned no terminalId");
  }
  const terminalId = created.terminalId;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let output = "";
    const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
    for (;;) {
      if (aborted) {
        await deps
          .callSocket("terminal-kill", { terminalId }, REQUEST_TIMEOUT_MS)
          .catch(() => {});
        throw new Error("command aborted");
      }
      if (Date.now() > deadline) {
        await deps
          .callSocket("terminal-kill", { terminalId }, REQUEST_TIMEOUT_MS)
          .catch(() => {});
        throw new Error("command timed out");
      }
      const state = (await deps.callSocket(
        "terminal-output",
        { terminalId },
        REQUEST_TIMEOUT_MS,
      )) as { output?: unknown; exitCode?: unknown };
      if (typeof state.output === "string") output = state.output;
      if (typeof state.exitCode === "number") {
        if (state.exitCode !== 0) {
          throw new Error(
            `command exited ${state.exitCode}: ${output.slice(-1000)}`,
          );
        }
        return output;
      }
      await sleep(400);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await deps
      .callSocket("terminal-release", { terminalId }, REQUEST_TIMEOUT_MS)
      .catch(() => {});
  }
}

function textResult(text: string): {
  content: { type: "text"; text: string }[];
  details: Record<string, never>;
} {
  return { content: [{ type: "text", text }], details: {} };
}

export function createAcpTools(deps: ToolDeps) {
  const readTool = defineTool({
    name: "acp_read",
    label: "acp_read",
    description: "Read a file. Prefers the editor buffer when available.",
    parameters: Type.Object({
      path: Type.String({
        description: "File path, absolute or relative to the session directory",
      }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const abs = resolveAbs(ctx.cwd, params.path);
      await runPolicy(deps, ctx, "acp_read", "read", abs, "read", toolCallId);
      const caps = deps.getCaps();
      const text =
        caps.fs?.readTextFile === true
          ? await readThroughClient(deps, abs)
          : readLocal(abs);
      return textResult(truncateText(text, "acp"));
    },
  });

  const writeTool = defineTool({
    name: "acp_write",
    label: "acp_write",
    description:
      "Create a new file. Refuses existing paths and conflict markers.",
    parameters: Type.Object({
      path: Type.String({
        description: "File path, absolute or relative to the session directory",
      }),
      content: Type.String({ description: "Full file content" }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      if (hasConflictMarkers(params.content)) {
        throw new Error("pi-acp: content contains conflict markers");
      }
      const abs = resolveAbs(ctx.cwd, params.path);
      await runPolicy(deps, ctx, "acp_write", "edit", abs, "edit", toolCallId);
      const caps = deps.getCaps();
      let exists = existsLocal(abs);
      if (!exists && caps.fs?.readTextFile === true) {
        try {
          await readThroughClient(deps, abs);
          exists = true;
        } catch {
          exists = false;
        }
      }
      if (exists) throw new Error(`pi-acp: path already exists: ${abs}`);
      const canWriteClient = deps.getCaps().fs?.writeTextFile === true;
      if (canWriteClient) await writeThroughClient(deps, abs, params.content);
      else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, params.content);
      }
      return textResult(`Created ${displayPath(ctx.cwd, abs)}`);
    },
  });

  const editTool = defineTool({
    name: "acp_edit",
    label: "acp_edit",
    description:
      "Edit a file with exact oldText/newText replacements. Refuses conflict markers and mismatched editor buffers.",
    parameters: Type.Object({
      path: Type.String({
        description: "File path, absolute or relative to the session directory",
      }),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String(),
          newText: Type.String(),
        }),
      ),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      for (const edit of params.edits) {
        if (hasConflictMarkers(edit.newText)) {
          throw new Error("pi-acp: content contains conflict markers");
        }
      }
      const abs = resolveAbs(ctx.cwd, params.path);
      await runPolicy(deps, ctx, "acp_edit", "edit", abs, "edit", toolCallId);
      const caps = deps.getCaps();
      let local: string;
      try {
        local = readLocal(abs);
      } catch {
        throw new Error(`pi-acp: file not found: ${abs}`);
      }
      if (caps.fs?.readTextFile === true) {
        let remote: string | undefined;
        try {
          remote = await readThroughClient(deps, abs);
        } catch {
          remote = undefined;
        }
        if (remote !== undefined && remote !== local) {
          throw new Error(
            "pi-acp: editor buffer differs from disk; refusing to edit",
          );
        }
      }
      const updated = applyEdits(local, params.edits);
      const canWriteClient = deps.getCaps().fs?.writeTextFile === true;
      if (canWriteClient) await writeThroughClient(deps, abs, updated);
      else writeFileSync(abs, updated);
      return textResult(`Edited ${displayPath(ctx.cwd, abs)}`);
    },
  });

  const bashTool = defineTool({
    name: "acp_bash",
    label: "acp_bash",
    description:
      "Run a shell command. Asks the client for approval; without a client, the local policy applies.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command" }),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const verdict = evaluate({
        owner: ctx.sessionManager,
        cwd: ctx.cwd,
        tag: "shell",
        target: params.command,
        rules: loadPermissions(ctx),
      });
      if (verdict === "deny") {
        throw new Error("pi-acp: bash denied: policy denies shell");
      }
      if (verdict === "ask") {
        if (!deps.connected()) {
          throw new Error(
            "pi-acp: bash denied: no client connected to approve",
          );
        }
        await askPermission(
          deps,
          "acp_bash",
          params.command,
          "execute",
          toolCallId,
        );
      }
      const caps = deps.getCaps();
      const output =
        caps.terminal === true
          ? await runTerminal(
              deps,
              params.command,
              ctx.cwd,
              signal ?? undefined,
            )
          : await localBash(params.command, ctx.cwd, signal ?? undefined);
      return textResult(truncateText(output, "acp"));
    },
  });

  const fdTool = defineTool({
    name: "acp_fd",
    label: "acp_fd",
    description: "Find files by glob pattern on local disk, newest first.",
    parameters: Type.Object({
      pattern: Type.String({ description: 'Glob pattern, e.g. "*.ts"' }),
      path: Type.Optional(Type.String({ description: "Directory to search" })),
      max_results: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      const searchDir = resolve(root, params.path ?? ".");
      await runPolicy(
        deps,
        ctx,
        "acp_fd",
        "search",
        searchDir,
        "search",
        toolCallId,
      );
      const stdout = await runBinary(
        "fd",
        ["--glob", params.pattern, "--", "."],
        searchDir,
        signal ?? undefined,
      );
      const rules = loadPermissions(ctx);
      const found: { rel: string; mtime: number }[] = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        const abs = resolve(searchDir, trimmed);
        let mtime: number | undefined;
        try {
          mtime = statSync(abs).mtimeMs;
        } catch {
          continue;
        }
        if (checkPath(rules, abs, "search", root) === "deny") continue;
        found.push({ rel: displayPath(root, abs), mtime });
      }
      found.sort((a, b) => b.mtime - a.mtime);
      const paths = found
        .slice(0, clampMaxResults(params.max_results))
        .map((entry) => entry.rel);
      return textResult(
        paths.length > 0 ? paths.join("\n") : "No files found.",
      );
    },
  });

  const rgTool = defineTool({
    name: "acp_rg",
    label: "acp_rg",
    description: "Search file contents by regex on local disk.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regex pattern" }),
      path: Type.Optional(
        Type.String({ description: "Directory or file to search" }),
      ),
      glob: Type.Optional(Type.String({ description: "File filter glob" })),
      max_results: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      const target = resolve(root, params.path ?? ".");
      await runPolicy(
        deps,
        ctx,
        "acp_rg",
        "search",
        target,
        "search",
        toolCallId,
      );
      const args = [
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "--regexp",
        params.pattern,
      ];
      if (params.glob !== undefined) args.push("--glob", params.glob);
      args.push("--", params.path ?? ".");
      const stdout = await runBinary("rg", args, root, signal ?? undefined, {
        okExitCodes: [1],
      });
      const rules = loadPermissions(ctx);
      const matches: string[] = [];
      for (const line of stdout.split("\n")) {
        if (line.trim() === "") continue;
        const match = /^(.*):(\d+):(.*)$/.exec(line);
        if (match === null) continue;
        const abs = resolve(root, match[1]);
        if (checkPath(rules, abs, "search", root) === "deny") continue;
        const text = `${displayPath(root, abs)}:${match[2]}:${match[3]}`;
        matches.push(text.length > 300 ? text.slice(0, 300) : text);
        if (matches.length >= clampMaxResults(params.max_results)) break;
      }
      return textResult(
        matches.length > 0 ? matches.join("\n") : "No matches found.",
      );
    },
  });

  const ezaTool = defineTool({
    name: "acp_eza",
    label: "acp_eza",
    description: "List a directory with eza on local disk.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to list" })),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const dir = resolve(ctx.cwd, params.path ?? ".");
      await runPolicy(deps, ctx, "acp_eza", "search", dir, "other", toolCallId);
      let isDirectory = false;
      try {
        isDirectory = statSync(dir).isDirectory();
      } catch {
        isDirectory = false;
      }
      if (!isDirectory) {
        throw new Error(`pi-acp: not a directory: ${params.path ?? "."}`);
      }
      const stdout = await runBinary(
        "eza",
        ["--long", "--group-directories-first", "--", dir],
        ctx.cwd,
        undefined,
      );
      return textResult(truncateText(stdout, "acp"));
    },
  });

  return [readTool, writeTool, editTool, bashTool, fdTool, rgTool, ezaTool];
}
