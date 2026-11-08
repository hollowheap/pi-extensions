import { isAbsolute, resolve } from "node:path";
import { runCapture } from "@hollowheap/runtime/exec";
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

export function evaluateCondition(
  entry: HookEntry,
  payload: HookPayload,
): boolean {
  if (!entry.condition) return true;
  const raw = entry.condition.trim();
  if (raw === "") return true;

  // matches(var, 'pattern')
  const matchesMatch = raw.match(
    /^matches\(\s*([a-zA-Z0-9_]+)\s*,\s*['"](.*)['"]\s*\)$/i,
  );
  if (matchesMatch) {
    const varName = matchesMatch[1].toLowerCase();
    const pattern = matchesMatch[2];
    const regex = new RegExp(pattern);
    const target =
      varName === "toolname" || varName === "tool"
        ? payload.toolName
        : String(
            payload.input?.[varName] ??
              (varName === "path" ? payload.input?.command : "") ??
              "",
          );
    return regex.test(target);
  }

  // Simple: "tool == 'name'" or "tool != 'name'"
  const toolMatch = raw.match(/^(?:tool|toolname)\s*==\s*['"](.+)['"]$/i);
  if (toolMatch) {
    return payload.toolName.toLowerCase() === toolMatch[1].toLowerCase();
  }

  const toolNotMatch = raw.match(/^(?:tool|toolname)\s*!=\s*['"](.+)['"]$/i);
  if (toolNotMatch) {
    return payload.toolName.toLowerCase() !== toolNotMatch[1].toLowerCase();
  }

  // "path contains 'str'"
  const pathContains = raw.match(/^path\s+contains\s+['"](.+)['"]$/i);
  if (pathContains) {
    const target = String(payload.input?.path ?? payload.input?.command ?? "");
    return target.toLowerCase().includes(pathContains[1].toLowerCase());
  }

  throw new Error(`invalid hook condition: "${entry.condition}"`);
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
  let command = entry.command;
  const isRelative =
    !isAbsolute(command) &&
    (command.includes("/") ||
      command.includes("\\") ||
      command === "." ||
      command === "..");
  if (isRelative) {
    if (entry.configDir !== undefined) {
      command = resolve(entry.configDir, command);
    } else {
      return {
        code: 1,
        stdout: "",
        stderr: `cannot execute relative command "${command}" without declaring config directory`,
      };
    }
  }
  return runCapture(command, entry.args, payload.cwd, undefined, {
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
    if (output === "") return {};
    if (entry.format === "markdown") {
      return { output: `\`\`\`\n${output}\n\`\`\`` };
    }
    return { output };
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
