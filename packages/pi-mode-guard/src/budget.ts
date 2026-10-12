const usedTokens = new Map<unknown, number>();

export function getBudgetUsed(owner: unknown): number {
  return usedTokens.get(owner) ?? 0;
}

export function addBudgetUsage(owner: unknown, tokens: number): number {
  const total = getBudgetUsed(owner) + tokens;
  usedTokens.set(owner, total);
  return total;
}

export function clearBudget(owner: unknown): void {
  usedTokens.delete(owner);
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatBudget(used: number, cap: number | undefined): string {
  if (cap === undefined) return used === 0 ? "" : `${formatCount(used)} used`;
  return `${formatCount(used)} used, ${formatCount(Math.max(cap - used, 0))} remaining`;
}
