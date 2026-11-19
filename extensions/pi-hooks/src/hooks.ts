import { resolve } from "node:path";
import { errorMessage } from "@hollowheap/core/format";
import { runCapture } from "@hollowheap/runtime/exec";
import {
  type HookEntry,
  type HookSandboxConfig,
  isRelativeCommandPath,
  parseCondition,
  resolveHookSandboxOptions,
} from "./settings.js";

export type { HookEntry, HookSandboxConfig } from "./settings.js";

export interface HookPayload {
  event: "pre_tool" | "post_tool";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  cwd: string;
  mode: string;
}

export interface SessionHookPayload {
  event: "session_start";
  cwd: string;
  mode: string;
}

export type HookInput = HookPayload | SessionHookPayload;

export interface PreVerdict {
  block: boolean;
  reason?: string;
}

export interface PostHookResult {
  output?: string;
  error?: string;
}

export interface SessionHookResult {
  error?: string;
}

function readInputField(
  input: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return input !== undefined && Object.hasOwn(input, key)
    ? input[key]
    : undefined;
}

export function evaluateCondition(
  entry: HookEntry,
  payload: HookInput,
): boolean {
  const raw = entry.condition?.trim();
  if (!raw) return true;
  if (payload.event === "session_start") return false;

  const parsed = parseCondition(raw);
  switch (parsed.kind) {
    case "always":
      return true;
    case "matches": {
      const target =
        parsed.varName === "toolname" || parsed.varName === "tool"
          ? payload.toolName
          : String(
              readInputField(payload.input, parsed.varName) ??
                (parsed.varName === "path"
                  ? readInputField(payload.input, "command")
                  : "") ??
                "",
            );
      return parsed.regex.test(target);
    }
    case "tool": {
      const matches = payload.toolName.toLowerCase() === parsed.value;
      return parsed.op === "==" ? matches : !matches;
    }
    case "pathContains": {
      const target = String(
        readInputField(payload.input, "path") ??
          readInputField(payload.input, "command") ??
          "",
      );
      return target.toLowerCase().includes(parsed.value);
    }
  }
}

export function matchesTool(entry: HookEntry, toolName: string): boolean {
  const matcher = entry.matcher.toLowerCase();
  if (matcher === "") return true;
  const name = toolName.toLowerCase();
  if (matcher.endsWith("*")) return name.startsWith(matcher.slice(0, -1));
  return matcher === name;
}

function reasonOf(value: unknown): string {
  if (typeof value !== "object" || value === null) return "blocked by hook";
  const reason = (value as { reason?: unknown }).reason;
  return typeof reason === "string" && reason !== ""
    ? reason
    : "blocked by hook";
}

export function interpretPreHook(result: {
  code: number;
  stdout: string;
  stderr: string;
}): PreVerdict {
  if (result.code === 2) {
    return {
      block: true,
      reason: result.stderr.trim() || "blocked by hook",
    };
  }
  if (result.code !== 0) {
    return {
      block: true,
      reason:
        result.stderr.trim() || `hook failed with exit code ${result.code}`,
    };
  }
  const stdout = result.stdout.trim();
  if (stdout === "") return { block: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      block: true,
      reason: "hook printed output that is not a decision",
    };
  }
  const decision =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { decision?: unknown }).decision
      : undefined;
  if (decision === "allow") return { block: false };
  if (decision === "block") return { block: true, reason: reasonOf(parsed) };
  return { block: true, reason: "hook returned an unknown decision" };
}

function run(
  entry: HookEntry,
  payload: HookInput,
  defaultSandbox?: boolean | HookSandboxConfig,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let command = entry.command;
  if (isRelativeCommandPath(command)) {
    if (entry.configDir !== undefined) {
      command = resolve(entry.configDir, command);
    } else {
      return Promise.resolve({
        code: 1,
        stdout: "",
        stderr: `cannot execute relative command "${command}" without declaring config directory`,
      });
    }
  }
  const sandbox = resolveHookSandboxOptions(entry.sandbox ?? defaultSandbox);
  return runCapture(command, entry.args, payload.cwd, undefined, {
    input: JSON.stringify(payload),
    timeoutMs: entry.timeoutMs,
    ...(sandbox !== undefined ? { sandbox } : {}),
  });
}

export async function runPreHook(
  entry: HookEntry,
  payload: HookPayload,
  defaultSandbox?: boolean | HookSandboxConfig,
): Promise<PreVerdict> {
  try {
    return interpretPreHook(await run(entry, payload, defaultSandbox));
  } catch (error) {
    return {
      block: true,
      reason: errorMessage(error),
    };
  }
}

export async function runPostHook(
  entry: HookEntry,
  payload: HookPayload,
  defaultSandbox?: boolean | HookSandboxConfig,
): Promise<PostHookResult> {
  try {
    const result = await run(entry, payload, defaultSandbox);
    if (result.code !== 0) {
      return {
        error:
          result.stderr.trim() || `hook failed with exit code ${result.code}`,
      };
    }
    const output = result.stdout.trim();
    if (output === "") return {};
    if (entry.format === "markdown") {
      return { output: `\`\`\`\n${output}\n\`\`\`` };
    }
    return { output };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function runSessionHook(
  entry: HookEntry,
  payload: SessionHookPayload,
  defaultSandbox?: boolean | HookSandboxConfig,
): Promise<SessionHookResult> {
  try {
    const result = await run(entry, payload, defaultSandbox);
    if (result.code !== 0) {
      return {
        error:
          result.stderr.trim() || `hook failed with exit code ${result.code}`,
      };
    }
    return {};
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
