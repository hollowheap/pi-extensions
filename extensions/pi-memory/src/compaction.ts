import type {
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
} from "@earendil-works/pi-coding-agent";
import {
  memoryFromEntries,
  renderMemory,
  sourceEntryCoverage,
} from "./ledger.js";
import { redactSecrets } from "./redact.js";
import type { MemoryConfig } from "./settings.js";

const COMPACTED_OBSERVATION_IDS = "hollowheap.memory.compactedObservationIds";

export function messageEntryIds(entries: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const typed = entry as { type?: unknown; id?: unknown };
    if (typed.type === "message" && typeof typed.id === "string") {
      ids.push(typed.id);
    }
  }
  return ids;
}

export function stringHeaders(
  headers: Record<string, string | null> | undefined,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function compactionDetailStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function trackedFileBlock(
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  const sections: string[] = [];
  if (readFiles.length > 0)
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  if (modifiedFiles.length > 0)
    sections.push(
      `<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`,
    );
  return sections.join("\n\n");
}

export function compactFromMemory(
  event: SessionBeforeCompactEvent,
  config: MemoryConfig,
): SessionBeforeCompactResult["compaction"] {
  const { branchEntries: branch, preparation, customInstructions } = event;
  if (
    !Array.isArray(branch) ||
    preparation.isSplitTurn ||
    preparation.turnPrefixMessages.length > 0 ||
    customInstructions?.trim()
  ) {
    return undefined;
  }

  const { firstKeptEntryId, previousSummary, tokensBefore, fileOps } =
    preparation;
  const cutoff = branch.findIndex((entry) => entry.id === firstKeptEntryId);
  const previous = [...branch]
    .reverse()
    .find((entry) => entry.type === "compaction");
  const start = previous
    ? branch.findIndex((entry) => entry.id === previous.firstKeptEntryId)
    : 0;
  if (
    start < 0 ||
    cutoff <= start ||
    (previous && previousSummary === undefined)
  ) {
    return undefined;
  }

  const discarded = branch.slice(start, cutoff);
  const sources = new Set(
    discarded
      .filter(
        (entry) => entry.type === "message" && entry.message.role !== "system",
      )
      .map((entry) => entry.id),
  );
  // Saved observations describe the raw messages, so context replacements or
  // visible entries outside that source format need model-assisted compaction.
  if (
    sources.size === 0 ||
    sources.size !== preparation.messagesToSummarize.length ||
    discarded.some(
      (entry) =>
        entry.type === "branch_summary" || entry.type === "custom_message",
    ) ||
    branch.some(
      (entry) => entry.type === "context_edit" && sources.has(entry.targetId),
    )
  ) {
    return undefined;
  }

  const memoryLedger = memoryFromEntries(branch);
  const { coveredIds, observationIds } = sourceEntryCoverage(
    messageEntryIds(branch),
    memoryLedger.observations,
    sources,
  );
  if (coveredIds.size !== sources.size) return undefined;

  const priorDetails = previous?.details as
    | {
        readFiles?: unknown;
        modifiedFiles?: unknown;
        [COMPACTED_OBSERVATION_IDS]?: unknown;
      }
    | undefined;
  const alreadySummarized = new Set(
    compactionDetailStrings(priorDetails?.[COMPACTED_OBSERVATION_IDS]),
  );
  const newObservations = memoryLedger.observations.filter(
    (observation) =>
      observationIds.has(observation.id) &&
      !alreadySummarized.has(observation.id),
  );
  const memory = renderMemory(
    { ...memoryLedger, observations: newObservations, reflections: [] },
    { maxTokens: Number.POSITIVE_INFINITY },
  );

  const priorReads = compactionDetailStrings(priorDetails?.readFiles);
  const priorModified = compactionDetailStrings(priorDetails?.modifiedFiles);
  const priorBlock = trackedFileBlock(priorReads, priorModified);
  let priorProse = previousSummary ?? "";
  // The host appends the tracked-file block. Remove only a known exact suffix.
  if (priorBlock !== "") {
    for (const block of [priorBlock, redactSecrets(priorBlock)]) {
      if (priorProse === block) {
        priorProse = "";
        break;
      }
      const suffix = `\n\n${block}`;
      if (priorProse.endsWith(suffix)) {
        priorProse = priorProse.slice(0, -suffix.length);
        break;
      }
    }
  }
  if (priorProse === "" && memory === "") return undefined;

  const modified = new Set([
    ...priorModified,
    ...fileOps.written,
    ...fileOps.edited,
  ]);
  const readFiles = [...new Set([...priorReads, ...fileOps.read])]
    .filter((path) => !modified.has(path))
    .sort();
  const modifiedFiles = [...modified].sort();
  const joined = [
    priorProse,
    memory,
    trackedFileBlock(readFiles, modifiedFiles),
  ]
    .filter(Boolean)
    .join("\n\n");
  const summary = config.redactSecrets ? redactSecrets(joined) : joined;
  if (summary.length > config.injectionTokens * 4) return undefined;

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: {
      readFiles,
      modifiedFiles,
      [COMPACTED_OBSERVATION_IDS]: memoryLedger.observations
        .filter(
          (observation) =>
            alreadySummarized.has(observation.id) ||
            observationIds.has(observation.id),
        )
        .map((observation) => observation.id),
    },
  };
}
