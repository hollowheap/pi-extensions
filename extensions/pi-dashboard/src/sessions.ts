import { readFile } from "node:fs/promises";
import {
  type SessionInfo,
  SessionManager,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import {
  type PersistedSessionSummary,
  extractSessionSummaryFromEntries,
} from "@hollowheap/core/snapshot";

export interface DashboardSessionItem {
  id: string;
  path: string;
  name?: string;
  cwd: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  summary: PersistedSessionSummary;
}

export interface LoadRecentSessionsOptions {
  cwd: string;
  sessionDir?: string;
  currentSessionId?: string;
  limit?: number;
  scope?: "cwd" | "all";
  listSessions?: (cwd: string, sessionDir?: string) => Promise<SessionInfo[]>;
  listAllSessions?: () => Promise<SessionInfo[]>;
  readFileText?: (path: string) => Promise<string>;
}

const MAX_CACHE_ENTRIES = 64;
const summaryCache = new Map<string, PersistedSessionSummary>();

function cacheGet(key: string): PersistedSessionSummary | undefined {
  const hit = summaryCache.get(key);
  if (hit === undefined) return undefined;
  summaryCache.delete(key);
  summaryCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: PersistedSessionSummary): void {
  if (summaryCache.has(key)) summaryCache.delete(key);
  summaryCache.set(key, value);
  if (summaryCache.size > MAX_CACHE_ENTRIES) {
    const oldest = summaryCache.keys().next().value;
    if (oldest !== undefined) summaryCache.delete(oldest);
  }
}

export function clearSessionSummaryCache(): void {
  summaryCache.clear();
}

export function formatRelativeAge(
  date: Date | number,
  now = Date.now(),
): string {
  const ts = typeof date === "number" ? date : date.getTime();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return "now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export function sessionDisplayTitle(
  item: Pick<DashboardSessionItem, "name" | "firstMessage" | "id">,
): string {
  const raw =
    item.name?.trim() ||
    item.firstMessage.trim() ||
    `session ${item.id.slice(0, 8)}`;
  const clean = sanitizeTerminalText(raw, { allowSgr: false })
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 0 ? clean : `session ${item.id.slice(0, 8)}`;
}

async function readSessionSummary(
  info: SessionInfo,
  readFileText: (path: string) => Promise<string>,
): Promise<PersistedSessionSummary> {
  if (!info.path) return {};
  const cacheKey = `${info.path}:${info.modified.getTime()}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const raw = await readFileText(info.path);
    const entries = parseSessionEntries(raw);
    const summary = extractSessionSummaryFromEntries(entries);
    cacheSet(cacheKey, summary);
    return summary;
  } catch {
    return {};
  }
}

export async function loadRecentSessions(
  options: LoadRecentSessionsOptions,
): Promise<DashboardSessionItem[]> {
  const limit = Math.max(1, options.limit ?? 5);
  const scope = options.scope ?? "cwd";
  const listSessions =
    options.listSessions ??
    ((cwd, sessionDir) => SessionManager.list(cwd, sessionDir));
  const listAllSessions =
    options.listAllSessions ?? (() => SessionManager.listAll());
  const readFileText =
    options.readFileText ?? ((filePath) => readFile(filePath, "utf8"));

  let rawList: SessionInfo[] = [];
  try {
    rawList =
      scope === "all"
        ? await listAllSessions()
        : await listSessions(options.cwd, options.sessionDir);
  } catch {
    return [];
  }

  const byId = new Map<string, SessionInfo>();
  for (const info of rawList) {
    if (options.currentSessionId && info.id === options.currentSessionId) {
      continue;
    }
    if (!(info.messageCount > 0 || Boolean(info.name?.trim()))) continue;
    const existing = byId.get(info.id);
    if (
      existing === undefined ||
      info.modified.getTime() > existing.modified.getTime()
    ) {
      byId.set(info.id, info);
    }
  }
  const filtered = [...byId.values()]
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, limit);

  return Promise.all(
    filtered.map(async (info) => ({
      id: info.id,
      path: info.path,
      ...(info.name !== undefined ? { name: info.name } : {}),
      cwd: info.cwd,
      created: info.created,
      modified: info.modified,
      messageCount: info.messageCount,
      firstMessage: info.firstMessage,
      summary: await readSessionSummary(info, readFileText),
    })),
  );
}
