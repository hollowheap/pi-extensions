import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { isProcessAlive } from "@hollowheap/runtime/process";
import { requestJsonl } from "@hollowheap/runtime/socket";
import type { SubagentState } from "./state.js";

export interface RunnerRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function requestId(): string {
  return `subagent-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export async function runnerRequest(
  state: SubagentState,
  action: string,
  payload?: unknown,
  options: RunnerRequestOptions = {},
): Promise<unknown> {
  if (state.socket === undefined) {
    throw new Error(`subagent ${state.id} has no control socket`);
  }
  return requestJsonl(
    state.socket,
    { id: requestId(), action, payload },
    { timeoutMs: options.timeoutMs ?? 10_000, signal: options.signal },
  );
}

export function readLogFailureDetail(
  logPaths: readonly string[],
): string | undefined {
  for (const path of logPaths) {
    if (!path) continue;
    try {
      const text = readFileSync(path, "utf8").trim();
      if (text !== "") {
        const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
        const tail = lines.slice(-3).join(" | ");
        return tail.length > 240 ? `${tail.slice(0, 237)}...` : tail;
      }
    } catch {
      // Ignore missing log files.
    }
  }
  return undefined;
}

export async function waitForRunner(
  state: SubagentState,
  timeoutMs = 2_000,
  runner?: {
    pid: number;
    startTime?: number;
    logPath?: string;
    childLogPath?: string;
  },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  const logPaths = [runner?.childLogPath ?? "", runner?.logPath ?? ""].filter(
    Boolean,
  );
  while (Date.now() < deadline) {
    if (runner !== undefined && !isProcessAlive(runner.pid, runner.startTime)) {
      const logDetail = readLogFailureDetail(logPaths);
      if (logDetail !== undefined) {
        throw new Error(
          `runner for ${state.id} exited before its socket was ready: ${logDetail}`,
        );
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(
            `runner for ${state.id} exited before its socket was ready`,
          );
    }
    try {
      await runnerRequest(state, "status", undefined, { timeoutMs: 200 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const logDetail = readLogFailureDetail(logPaths);
  if (logDetail !== undefined) {
    throw new Error(
      `subagent ${state.id} socket did not become ready: ${logDetail}`,
    );
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`subagent ${state.id} socket did not become ready`);
}
