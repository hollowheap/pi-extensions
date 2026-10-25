import { runCapture } from "@hollowheap/core";
import type { HookEntry } from "./config.js";

export type { HookEntry } from "./config.js";

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

async function run(
  entry: HookEntry,
  payload: HookInput,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runCapture(entry.command, entry.args, payload.cwd, undefined, {
    input: JSON.stringify(payload),
    timeoutMs: entry.timeoutMs,
  });
}

export async function runPreHook(
  entry: HookEntry,
  payload: HookPayload,
): Promise<PreVerdict> {
  try {
    return interpretPreHook(await run(entry, payload));
  } catch (error) {
    return {
      block: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runPostHook(
  entry: HookEntry,
  payload: HookPayload,
): Promise<PostHookResult> {
  try {
    const result = await run(entry, payload);
    if (result.code !== 0) {
      return {
        error:
          result.stderr.trim() || `hook failed with exit code ${result.code}`,
      };
    }
    const output = result.stdout.trim();
    return output === "" ? {} : { output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runSessionHook(
  entry: HookEntry,
  payload: SessionHookPayload,
): Promise<SessionHookResult> {
  try {
    const result = await run(entry, payload);
    if (result.code !== 0) {
      return {
        error:
          result.stderr.trim() || `hook failed with exit code ${result.code}`,
      };
    }
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
