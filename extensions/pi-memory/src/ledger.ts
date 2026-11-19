import { randomUUID } from "node:crypto";
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@hollowheap/core/records";

export const MEMORY_OBSERVATION_TYPE = "hollowheap.memory.observation";
export const MEMORY_REFLECTION_TYPE = "hollowheap.memory.reflection";
export const MEMORY_CONSUMED_TYPE = "hollowheap.memory.consumed";
export const MEMORY_CLEAR_TYPE = "hollowheap.memory.clear";
export const MEMORY_WORKSPACE_TYPE = "hollowheap.memory.workspace";

export function observationId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

export interface MemoryObservation {
  id: string;
  text: string;
  relevance: number;
  createdAt: number;
  sourceEntryIds: string[];
  coversUpToId?: string;
}

export interface MemoryReflection {
  id: string;
  text: string;
  createdAt: number;
  sourceObservationIds: string[];
}

export interface MemoryLedger {
  observations: MemoryObservation[];
  reflections: MemoryReflection[];
  consumedIds: Set<string>;
}

export function emptyMemoryLedger(): MemoryLedger {
  return {
    observations: [],
    reflections: [],
    consumedIds: new Set(),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.replace(/\s+/g, " ").trim()
    : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTimestamp(value: unknown, fallback?: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : (fallback ?? Date.now());
}

function readRelevance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

export function parseObservation(
  data: unknown,
  fallbackCreatedAt?: number,
): MemoryObservation | undefined {
  if (!isRecord(data)) return undefined;
  const id = readString(data.id);
  const text = readString(data.text);
  if (id === undefined || text === undefined) return undefined;
  return {
    id,
    text,
    relevance: readRelevance(data.relevance),
    createdAt: readTimestamp(data.createdAt, fallbackCreatedAt),
    sourceEntryIds: readStringArray(data.sourceEntryIds),
    coversUpToId: readString(data.coversUpToId),
  };
}

function parseReflection(data: unknown): MemoryReflection | undefined {
  if (!isRecord(data)) return undefined;
  const id = readString(data.id);
  const text = readString(data.text);
  if (id === undefined || text === undefined) return undefined;
  return {
    id,
    text,
    createdAt: readTimestamp(data.createdAt),
    sourceObservationIds: readStringArray(data.sourceObservationIds),
  };
}

export function memoryFromEntries(entries: unknown): MemoryLedger {
  const ledger = emptyMemoryLedger();
  if (!Array.isArray(entries)) return ledger;

  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "custom") continue;
    const data = entry.data;
    switch (entry.customType) {
      case MEMORY_OBSERVATION_TYPE: {
        const observation = parseObservation(data);
        if (observation === undefined) break;
        if (!ledger.observations.some((item) => item.id === observation.id)) {
          ledger.observations.push(observation);
        }
        for (const id of observation.sourceEntryIds) {
          ledger.consumedIds.add(id);
        }
        break;
      }
      case MEMORY_REFLECTION_TYPE: {
        const reflection = parseReflection(data);
        if (reflection === undefined) break;
        if (!ledger.reflections.some((item) => item.id === reflection.id)) {
          ledger.reflections.push(reflection);
        }
        break;
      }
      case MEMORY_CONSUMED_TYPE: {
        if (!isRecord(data)) break;
        for (const id of readStringArray(data.sourceEntryIds)) {
          ledger.consumedIds.add(id);
        }
        break;
      }
      case MEMORY_CLEAR_TYPE: {
        ledger.observations = [];
        ledger.reflections = [];
        if (isRecord(data)) {
          for (const id of readStringArray(data.sourceEntryIds)) {
            ledger.consumedIds.add(id);
          }
        }
        break;
      }
    }
  }

  return ledger;
}

export function sourceEntryCoverage(
  sourceEntryIds: readonly string[],
  observations: readonly MemoryObservation[],
  selectedSources?: ReadonlySet<string>,
): { coveredIds: ReadonlySet<string>; observationIds: ReadonlySet<string> } {
  const positions = new Map(sourceEntryIds.map((id, index) => [id, index]));
  const coveredIds = new Set<string>();
  const observationIds = new Set<string>();
  for (const observation of observations) {
    if (observation.coversUpToId === undefined) continue;
    const watermark = positions.get(observation.coversUpToId);
    if (watermark === undefined) continue;

    // A watermark bounds this observation's batch. Earlier batches can have gaps.
    for (const id of observation.sourceEntryIds) {
      if (selectedSources?.has(id) === false) continue;
      const position = positions.get(id);
      if (position !== undefined && position <= watermark) {
        coveredIds.add(id);
        observationIds.add(observation.id);
      }
    }
  }
  return { coveredIds, observationIds };
}

export function pendingMessageEntries(
  entries: unknown,
  consumedIds: ReadonlySet<string>,
): SessionMessageEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry): entry is SessionMessageEntry =>
      isRecord(entry) &&
      entry.type === "message" &&
      typeof entry.id === "string" &&
      !consumedIds.has(entry.id),
  );
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function appendBudgetedLine(
  lines: string[],
  used: number,
  budget: number,
  line: string,
): number | undefined {
  if (used + line.length > budget) return undefined;
  lines.push(line);
  return used + line.length + 1;
}

export function renderMemory(
  ledger: MemoryLedger,
  options: { maxTokens: number },
): string {
  const budget = Math.max(1, Math.trunc(options.maxTokens)) * 4;
  const lines: string[] = [];
  let used = 0;
  let hasItem = false;

  if (ledger.reflections.length > 0) {
    used = appendBudgetedLine(lines, used, budget, "Reflections:") ?? used;
    for (const reflection of ledger.reflections) {
      const next = appendBudgetedLine(
        lines,
        used,
        budget,
        `- ${reflection.text.replace(/\s+/g, " ")}`,
      );
      if (next === undefined) break;
      used = next;
      hasItem = true;
    }
  }

  if (ledger.observations.length > 0) {
    const headerUsed = appendBudgetedLine(lines, used, budget, "Observations:");
    if (headerUsed !== undefined) used = headerUsed;
    const observations = [...ledger.observations].sort(
      (left, right) =>
        right.relevance - left.relevance || right.createdAt - left.createdAt,
    );
    for (const observation of observations) {
      const next = appendBudgetedLine(
        lines,
        used,
        budget,
        `- [${observation.relevance}] ${observation.text.replace(/\s+/g, " ")}`,
      );
      if (next === undefined) break;
      used = next;
      hasItem = true;
    }
  }

  if (!hasItem) return "";
  return `## Durable memory\n\n${lines.join("\n")}`;
}
