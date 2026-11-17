import type { Verdict } from "@hollowheap/core/types";

const byOwner = new Map<unknown, Map<string, Verdict>>();

export function sessionDecisionsFor(
  owner: unknown,
): ReadonlyMap<string, Verdict> | undefined {
  return byOwner.get(owner);
}

export function recordSessionDecision(
  owner: unknown,
  target: string,
  verdict: Verdict,
): void {
  let decisions = byOwner.get(owner);
  if (decisions === undefined) {
    decisions = new Map();
    byOwner.set(owner, decisions);
  }
  decisions.set(target, verdict);
}

export function clearSessionDecisions(owner: unknown): void {
  byOwner.delete(owner);
}
