import { formatDollarCost } from "@hollowheap/core";

const usedTokens = new Map<unknown, number>();
const tokenCaps = new Map<unknown, number>();
const usedDollars = new Map<unknown, number>();
const dollarCaps = new Map<unknown, number>();

export function getBudgetUsed(owner: unknown): number {
  return usedTokens.get(owner) ?? 0;
}

export function addBudgetUsage(owner: unknown, tokens: number): number {
  const total = getBudgetUsed(owner) + tokens;
  usedTokens.set(owner, total);
  return total;
}

export function setBudgetBaseline(owner: unknown, tokens: number): number {
  usedTokens.set(owner, tokens);
  return tokens;
}

export function getTokenCap(owner: unknown): number | undefined {
  return tokenCaps.get(owner);
}

export function setTokenCap(owner: unknown, cap: number): void {
  tokenCaps.set(owner, cap);
}

export function clearTokenCap(owner: unknown): void {
  tokenCaps.delete(owner);
}

export function getDollarUsed(owner: unknown): number {
  return usedDollars.get(owner) ?? 0;
}

export function addDollarUsage(owner: unknown, dollars: number): number {
  const total = getDollarUsed(owner) + dollars;
  usedDollars.set(owner, total);
  return total;
}

export function setDollarBaseline(owner: unknown, dollars: number): number {
  usedDollars.set(owner, dollars);
  return dollars;
}

export function getDollarCap(owner: unknown): number | undefined {
  return dollarCaps.get(owner);
}

export function setDollarCap(owner: unknown, cap: number): void {
  dollarCaps.set(owner, cap);
}

export function clearDollarCap(owner: unknown): void {
  dollarCaps.delete(owner);
}

export function clearBudget(owner: unknown): void {
  usedTokens.delete(owner);
  tokenCaps.delete(owner);
  usedDollars.delete(owner);
  dollarCaps.delete(owner);
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDollarBudget(
  dollarsUsed: number,
  dollarCap: number | undefined,
): string {
  if (dollarCap === undefined) {
    return dollarsUsed <= 0 ? "" : `${formatDollarCost(dollarsUsed)} used`;
  }
  const remaining = Math.max(dollarCap - dollarsUsed, 0);
  return `${formatDollarCost(dollarsUsed)} used, ${formatDollarCost(remaining)} remaining`;
}

export function formatBudget(
  used: number,
  cap: number | undefined,
  dollarsUsed?: number,
  dollarCap?: number,
): string {
  if (dollarCap !== undefined) {
    const dollarStr = formatDollarBudget(dollarsUsed ?? 0, dollarCap);
    if (cap !== undefined) {
      return `${dollarStr} (${formatCount(used)} / ${formatCount(cap)} tokens)`;
    }
    return dollarStr;
  }

  if (cap !== undefined) {
    return `${formatCount(used)} used, ${formatCount(Math.max(cap - used, 0))} remaining`;
  }

  if (dollarsUsed !== undefined && dollarsUsed > 0) {
    return `${formatDollarCost(dollarsUsed)} used (${formatCount(used)} tokens)`;
  }

  return used === 0 ? "" : `${formatCount(used)} used`;
}

export function formatCompactDollarBudget(
  dollarsUsed: number,
  dollarCap: number | undefined,
): string {
  if (dollarCap === undefined) {
    if (dollarsUsed <= 0) return "";
    const str3 = dollarsUsed.toFixed(3);
    return str3.endsWith("0") ? `$${dollarsUsed.toFixed(2)}` : `$${str3}`;
  }
  const has3 =
    dollarsUsed.toFixed(3).slice(-1) !== "0" ||
    dollarCap.toFixed(3).slice(-1) !== "0";
  const fmt = (d: number) => `$${d.toFixed(has3 ? 3 : 2)}`;
  return `${fmt(dollarsUsed)}/${fmt(dollarCap)}`;
}

export function formatCompactBudget(
  used: number,
  cap: number | undefined,
  dollarsUsed?: number,
  dollarCap?: number,
): string {
  if (dollarCap !== undefined) {
    return formatCompactDollarBudget(dollarsUsed ?? 0, dollarCap);
  }
  if (dollarsUsed !== undefined && dollarsUsed > 0) {
    return formatCompactDollarBudget(dollarsUsed, undefined);
  }
  if (cap !== undefined) {
    return `${formatCount(used)}/${formatCount(cap)}`;
  }
  return used === 0 ? "" : formatCount(used);
}
