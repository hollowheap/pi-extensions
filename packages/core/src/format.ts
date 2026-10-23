import { relative, sep } from "node:path";

const TRUNCATE_THRESHOLD = 4000;
const HEAD_LENGTH = 3000;
const TAIL_LENGTH = 1000;
const TARGET_LENGTH = 500;

export function truncateText(text: string, label = "truncated"): string {
  if (text.length <= TRUNCATE_THRESHOLD) return text;
  const cut = text.length - TRUNCATE_THRESHOLD;
  return `${text.slice(0, HEAD_LENGTH)}\n[${label}: cut ${cut} characters]\n${text.slice(-TAIL_LENGTH)}`;
}

export function displayTarget(target: string): string {
  return target.length > TARGET_LENGTH
    ? `${target.slice(0, TARGET_LENGTH)}…`
    : target;
}

export function displayPath(base: string, absolute: string): string {
  const rel = relative(base, absolute).split(sep).join("/");
  return rel.endsWith("/") && rel.length > 1 ? rel.slice(0, -1) : rel;
}
