import type { Tag } from "@hollowheap/core/types";

export const TOOL_TAGS: Record<string, Tag> = {
  write: "edit",
  edit: "edit",
  read: "read",
  find: "search",
  grep: "search",
  fd: "search",
  rg: "search",
  ls: "search",
  bash: "shell",
  powershell: "shell",
  task: "shell",
  subagent: "shell",
  web_search: "external",
  web_fetch: "external",
  lang: "read",
  decide: "external",
};

export const PASSTHROUGH_ACTIONS = new Set([
  "define",
  "delete",
  "list",
  "status",
  "wait",
  "cancel",
]);

export function readPathArg(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

export function readToolTarget(
  toolName: string,
  input: unknown,
): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  if (toolName === "web_fetch" && typeof record.url === "string") {
    return record.url;
  }
  if (toolName === "web_search" && typeof record.query === "string") {
    return record.query;
  }
  if (toolName === "decide") return "decide";
  return readPathArg(input);
}

export function readCommandArg(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const command = (input as Record<string, unknown>).command;
  if (typeof command === "string" && command !== "") return command;
  const agent = (input as Record<string, unknown>).agent;
  if (typeof agent === "string") {
    return `subagent ${agent}`;
  }
  const id = (input as Record<string, unknown>).id;
  if (typeof id === "string") return `subagent @${id}`;
  return "";
}

export function isPassthroughTaskCall(
  toolName: string,
  input: unknown,
): boolean {
  if (toolName !== "task" && toolName !== "subagent") {
    return false;
  }
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const action = (input as Record<string, unknown>).action;
  return typeof action === "string" && PASSTHROUGH_ACTIONS.has(action);
}
