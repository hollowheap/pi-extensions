import type { CwdQuery, CwdSetCommand } from "@hollowheap/core";

export const GUARD_CWD_SET_CHANNEL = "guard:cwd-set";
export const GUARD_CWD_QUERY_CHANNEL = "guard:cwd-query";

interface EventSink {
  emit(channel: string, data: unknown): void;
}

let eventSink: EventSink | undefined;

export function setEventSink(sink: EventSink | undefined): void {
  eventSink = sink;
}

export function setCwdOverride(owner: unknown, dir: string | undefined): void {
  const command: CwdSetCommand = { owner, dir };
  eventSink?.emit(GUARD_CWD_SET_CHANNEL, command);
}

export function resolveEffectiveDir(cwd: string, owner: unknown): string {
  const query: CwdQuery = { owner };
  eventSink?.emit(GUARD_CWD_QUERY_CHANNEL, query);
  return query.dir ?? cwd;
}
