import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";

export const MEMORY_OBSERVATION_TYPE = "hollowheap.memory.observation";
export const MEMORY_REFLECTION_TYPE = "hollowheap.memory.reflection";
export const MEMORY_CONSUMED_TYPE = "hollowheap.memory.consumed";
export const MEMORY_CLEAR_TYPE = "hollowheap.memory.clear";

export interface MemoryObservation {
  id: string;
  text: string;
  relevance: number;
  createdAt: number;
  sourceEntryIds: string[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : Date.now();
}

function readRelevance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

function parseObservation(data: unknown): MemoryObservation | undefined {
  if (!isRecord(data)) return undefined;
  const id = readString(data.id);
  const text = readString(data.text);
  if (id === undefined || text === undefined) return undefined;
  return {
    id,
    text,
    relevance: readRelevance(data.relevance),
    createdAt: readTimestamp(data.createdAt),
    sourceEntryIds: readStringArray(data.sourceEntryIds),
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

export function renderMemory(
  ledger: MemoryLedger,
  options: { maxTokens: number },
): string {
  const budget = Math.max(1, Math.trunc(options.maxTokens)) * 4;
  const lines: string[] = [];
  let used = 0;
  let hasItem = false;

  const append = (line: string): boolean => {
    if (used + line.length > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  if (ledger.reflections.length > 0) {
    append("Reflections:");
    for (const reflection of ledger.reflections) {
      if (!append(`- ${reflection.text.replace(/\s+/g, " ")}`)) break;
      hasItem = true;
    }
  }

  if (ledger.observations.length > 0) {
    append("Observations:");
    const observations = [...ledger.observations].sort(
      (left, right) =>
        right.relevance - left.relevance || right.createdAt - left.createdAt,
    );
    for (const observation of observations) {
      if (
        !append(
          `- [${observation.relevance}] ${observation.text.replace(/\s+/g, " ")}`,
        )
      )
        break;
      hasItem = true;
    }
  }

  if (!hasItem) return "";
  return `## Durable memory\n\n${lines.join("\n")}`;
}
