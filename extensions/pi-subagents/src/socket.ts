import { randomBytes } from "node:crypto";
import { requestJsonl } from "@hollowheap/process";
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

export async function waitForRunner(
  state: SubagentState,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await runnerRequest(state, "status", undefined, { timeoutMs: 200 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`subagent ${state.id} socket did not become ready`);
}
