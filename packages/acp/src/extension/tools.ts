import { execFile } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import {
  displayPath,
  displayTarget,
  errorMessage,
  toolTextResult,
  truncateText,
} from "@hollowheap/core/format";
import { evaluate } from "@hollowheap/core/modes";
import { resolveScopedPath } from "@hollowheap/core/scope";
import { effectiveCwd } from "@hollowheap/core/state";
import type { Rule, Tag } from "@hollowheap/core/types";
import { clampMaxResults, runBinary } from "@hollowheap/runtime/exec";
import type { ClientCaps } from "./client.js";
import { recordSessionDecision, sessionDecisionsFor } from "./decisions.js";
import { loadEvaluateOptions, loadPermissions } from "./permissions.js";

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

function resolveAbs(ctx: ExtensionContext, path: string): string {
  return resolveScopedPath(ctx.cwd, path, ctx.sessionManager);
}

function pathParameter() {
  return Type.String({
    description: "File path, absolute or relative to the session directory",
  });
}

function isSearchDenied(
  ctx: ExtensionContext,
  absPath: string,
  rules: readonly Rule[],
): boolean {
  return (
    evaluate({
      owner: ctx.sessionManager,
      cwd: ctx.cwd,
      tag: "search",
      target: absPath,
      rules,
      ...loadEvaluateOptions(ctx),
      sessionDecisions: sessionDecisionsFor(ctx.sessionManager),
    }) === "deny"
  );
}

function filterEzaOutput(
  stdout: string,
  dir: string,
  ctx: ExtensionContext,
  rules: readonly Rule[],
): string {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return stdout;
  }
  const denied = entries.filter((name) =>
    isSearchDenied(ctx, join(dir, name), rules),
  );
  if (denied.length === 0) return stdout;
  const deniedSet = new Set(denied);
  return stdout
    .split("\n")
    .filter((line) => {
      if (line.trim() === "") return true;
      for (const name of deniedSet) {
        if (
          line.endsWith(` ${name}`) ||
          line.includes(` ${name} -> `) ||
          line.trim() === name
        ) {
          return false;
        }
      }
      return true;
    })
    .join("\n");
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

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return true;
  const message = errorMessage(error);
  return /(?:not found|does not exist|ENOENT)/i.test(message);
}

function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  if (signal.aborted) return Promise.reject(new Error("pi-acp: aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("pi-acp: aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function askPermission(
  deps: ToolDeps,
  tool: string,
  target: string,
  kind: "read" | "edit" | "execute" | "search" | "other",
  toolCallId?: string,
  owner?: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const result = (await withAbort(
    deps.callSocket(
      "permission",
      {
        tool,
        target: displayTarget(target),
        kind,
        ...(toolCallId === undefined ? {} : { toolCallId }),
      },
      REQUEST_TIMEOUT_MS,
    ),
    signal,
  )) as { decision?: unknown };
  if (result.decision !== "allow_once") {
    throw new Error(
      `pi-acp: ${tool} ${displayTarget(target)} was not approved`,
    );
  }
  if (owner !== undefined) recordSessionDecision(owner, target, "allow");
}

export async function runPolicy(
  deps: ToolDeps,
  ctx: ExtensionContext,
  tool: string,
  tag: Tag,
  absPath: string,
  kind: "read" | "edit" | "execute" | "search" | "other",
  toolCallId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const verdict = evaluate({
    owner: ctx.sessionManager,
    cwd: ctx.cwd,
    tag,
    target: absPath,
    rules: loadPermissions(ctx),
    ...loadEvaluateOptions(ctx),
    sessionDecisions: sessionDecisionsFor(ctx.sessionManager),
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
    await askPermission(
      deps,
      tool,
      absPath,
      kind,
      toolCallId,
      ctx.sessionManager,
      signal,
    );
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
      const state = (await withAbort(
        deps.callSocket("terminal-output", { terminalId }, REQUEST_TIMEOUT_MS),
        signal,
      )) as { output?: unknown; exitCode?: unknown };
      if (aborted || signal?.aborted) {
        await deps
          .callSocket("terminal-kill", { terminalId }, REQUEST_TIMEOUT_MS)
          .catch(() => {});
        throw new Error("command aborted");
      }
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
  } catch (error) {
    if (signal?.aborted) {
      await deps
        .callSocket("terminal-kill", { terminalId }, REQUEST_TIMEOUT_MS)
        .catch(() => {});
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await deps
      .callSocket("terminal-release", { terminalId }, REQUEST_TIMEOUT_MS)
      .catch(() => {});
  }
}

export function createAcpTools(deps: ToolDeps) {
  const readTool = defineTool({
    name: "acp_read",
    label: "acp_read",
    description: "Read a file. Prefers the editor buffer when available.",
    parameters: Type.Object({
      path: pathParameter(),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const abs = resolveAbs(ctx, params.path);
      await runPolicy(
        deps,
        ctx,
        "acp_read",
        "read",
        abs,
        "read",
        toolCallId,
        signal ?? undefined,
      );
      const caps = deps.getCaps();
      const text =
        caps.fs?.readTextFile === true
          ? await readThroughClient(deps, abs)
          : readLocal(abs);
      return toolTextResult(truncateText(text, "acp"));
    },
  });

  const writeTool = defineTool({
    name: "acp_write",
    label: "acp_write",
    description:
      "Create a new file. Refuses existing paths and conflict markers.",
    parameters: Type.Object({
      path: pathParameter(),
      content: Type.String({ description: "Full file content" }),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      if (hasConflictMarkers(params.content)) {
        throw new Error("pi-acp: content contains conflict markers");
      }
      const abs = resolveAbs(ctx, params.path);
      await runPolicy(
        deps,
        ctx,
        "acp_write",
        "edit",
        abs,
        "edit",
        toolCallId,
        signal ?? undefined,
      );
      const caps = deps.getCaps();
      let exists = existsLocal(abs);
      if (!exists && caps.fs?.readTextFile === true) {
        try {
          await readThroughClient(deps, abs);
          exists = true;
        } catch (error) {
          if (existsLocal(abs) || !isMissingFileError(error)) {
            throw new Error(
              `pi-acp: cannot verify whether ${abs} exists in editor: ${errorMessage(error)}`,
            );
          }
        }
      }
      if (exists) throw new Error(`pi-acp: path already exists: ${abs}`);
      const canWriteClient = deps.getCaps().fs?.writeTextFile === true;
      if (canWriteClient) await writeThroughClient(deps, abs, params.content);
      else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, params.content);
      }
      return toolTextResult(`Created ${displayPath(ctx.cwd, abs)}`);
    },
  });

  const editTool = defineTool({
    name: "acp_edit",
    label: "acp_edit",
    description:
      "Edit a file with exact oldText/newText replacements. Refuses conflict markers and mismatched editor buffers.",
    parameters: Type.Object({
      path: pathParameter(),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String(),
          newText: Type.String(),
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      for (const edit of params.edits) {
        if (hasConflictMarkers(edit.newText)) {
          throw new Error("pi-acp: content contains conflict markers");
        }
      }
      const abs = resolveAbs(ctx, params.path);
      await runPolicy(
        deps,
        ctx,
        "acp_edit",
        "edit",
        abs,
        "edit",
        toolCallId,
        signal ?? undefined,
      );
      const caps = deps.getCaps();
      let local: string;
      try {
        local = readLocal(abs);
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
          throw new Error(`pi-acp: file not found: ${abs}`);
        }
        throw new Error(`pi-acp: cannot read ${abs}: ${errorMessage(error)}`);
      }
      if (caps.fs?.readTextFile === true) {
        let remote: string;
        try {
          remote = await readThroughClient(deps, abs);
        } catch (error) {
          throw new Error(
            `pi-acp: cannot read editor buffer for ${abs}: ${errorMessage(error)}`,
          );
        }
        if (remote !== local) {
          throw new Error(
            "pi-acp: editor buffer differs from disk; refusing to edit",
          );
        }
      }
      const updated = applyEdits(local, params.edits);
      const canWriteClient = deps.getCaps().fs?.writeTextFile === true;
      if (canWriteClient) await writeThroughClient(deps, abs, updated);
      else writeFileSync(abs, updated);
      return toolTextResult(`Edited ${displayPath(ctx.cwd, abs)}`);
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
        ...loadEvaluateOptions(ctx),
        sessionDecisions: sessionDecisionsFor(ctx.sessionManager),
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
          ctx.sessionManager,
          signal ?? undefined,
        );
      }
      const caps = deps.getCaps();
      const cwd = effectiveCwd(ctx.cwd, ctx.sessionManager);
      const output =
        caps.terminal === true
          ? await runTerminal(deps, params.command, cwd, signal ?? undefined)
          : await localBash(params.command, cwd, signal ?? undefined);
      return toolTextResult(truncateText(output, "acp"));
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
      const searchDir = resolveAbs(ctx, params.path ?? ".");
      await runPolicy(
        deps,
        ctx,
        "acp_fd",
        "search",
        searchDir,
        "search",
        toolCallId,
        signal ?? undefined,
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
        if (isSearchDenied(ctx, abs, rules)) continue;
        found.push({ rel: displayPath(root, abs), mtime });
      }
      found.sort((a, b) => b.mtime - a.mtime);
      const paths = found
        .slice(0, clampMaxResults(params.max_results))
        .map((entry) => entry.rel);
      return toolTextResult(
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
      const target = resolveAbs(ctx, params.path ?? ".");
      await runPolicy(
        deps,
        ctx,
        "acp_rg",
        "search",
        target,
        "search",
        toolCallId,
        signal ?? undefined,
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
      args.push("--", displayPath(root, target));
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
        if (isSearchDenied(ctx, abs, rules)) continue;
        const text = `${displayPath(root, abs)}:${match[2]}:${match[3]}`;
        matches.push(text.length > 300 ? text.slice(0, 300) : text);
        if (matches.length >= clampMaxResults(params.max_results)) break;
      }
      return toolTextResult(
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
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const dir = resolveAbs(ctx, params.path ?? ".");
      await runPolicy(
        deps,
        ctx,
        "acp_eza",
        "search",
        dir,
        "other",
        toolCallId,
        signal ?? undefined,
      );
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
      const filtered = filterEzaOutput(stdout, dir, ctx, loadPermissions(ctx));
      return toolTextResult(truncateText(filtered, "acp"));
    },
  });

  return [readTool, writeTool, editTool, bashTool, fdTool, rgTool, ezaTool];
}
