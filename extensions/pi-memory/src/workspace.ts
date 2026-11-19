import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { findAncestorMatch } from "@hollowheap/core/scope";
import type { MemoryObservation } from "./ledger.js";
import { redactSecrets } from "./redact.js";
import type { MemoryConfig } from "./settings.js";

export const MAX_OBSERVATION_CHARS = 500;
const MAX_RECORD_BYTES = 32_768;
const OBSERVATION_FILE = /^\d{16}-[a-f0-9]{64}\.json$/;

type Observation = Pick<
  MemoryObservation,
  "id" | "text" | "relevance" | "createdAt"
>;
type WorkspaceMemoryOptions = Pick<
  MemoryConfig,
  "maxObservations" | "redactSecrets"
>;

export interface WorkspaceObservation extends Observation {
  workspace: string;
  sessionOrigin: string;
  redacted: boolean;
}

export function resolveWorkspaceRoot(cwd: string): string | undefined {
  try {
    return findAncestorMatch(
      cwd,
      (dir) => {
        const marker = lstatSync(join(dir, ".pi"), { throwIfNoEntry: false });
        const git = lstatSync(join(dir, ".git"), { throwIfNoEntry: false });
        return marker?.isDirectory() ||
          marker?.isSymbolicLink() ||
          git?.isDirectory() ||
          git?.isFile()
          ? dir
          : undefined;
      },
      { canonical: true, includeRoot: false },
    );
  } catch {
    // Workspace storage is unavailable if the working directory cannot be resolved.
  }
  return undefined;
}

export function trustedWorkspaceRoot(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): string | undefined {
  return ctx.isProjectTrusted?.() && ctx.cwd
    ? resolveWorkspaceRoot(ctx.cwd)
    : undefined;
}

function directory(path: string, create: boolean): boolean {
  if (create) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function memoryDir(workspace: string, create: boolean): string | undefined {
  const piDir = join(workspace, ".pi");
  const dir = join(piDir, "memory");
  return directory(piDir, create) && directory(dir, create) ? dir : undefined;
}

function observationName(observation: WorkspaceObservation): string {
  const key = createHash("sha256")
    .update(JSON.stringify([observation.sessionOrigin, observation.id]))
    .digest("hex");
  return `${String(observation.createdAt).padStart(16, "0")}-${key}.json`;
}

function observationNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && OBSERVATION_FILE.test(entry.name))
    .map((entry) => entry.name);
}

function readObservation(
  dir: string,
  name: string,
  workspace: string,
): WorkspaceObservation | undefined {
  try {
    const fd = openSync(
      join(dir, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) return;
      const data = Buffer.alloc(stat.size);
      if (readSync(fd, data) !== stat.size) return;
      const item = JSON.parse(
        data.toString("utf8"),
      ) as Partial<WorkspaceObservation> | null;
      if (
        !item ||
        item.workspace !== workspace ||
        typeof item.sessionOrigin !== "string" ||
        item.sessionOrigin.trim() === "" ||
        typeof item.id !== "string" ||
        item.id.trim() === "" ||
        typeof item.text !== "string" ||
        item.text.length > MAX_OBSERVATION_CHARS ||
        item.text.trim() === "" ||
        typeof item.relevance !== "number" ||
        !Number.isFinite(item.relevance) ||
        typeof item.createdAt !== "number" ||
        !Number.isSafeInteger(item.createdAt) ||
        item.createdAt < 1 ||
        typeof item.redacted !== "boolean"
      ) {
        return;
      }
      const observation = item as WorkspaceObservation;
      if (observationName(observation) === name) return observation;
    } finally {
      closeSync(fd);
    }
  } catch {
    // Another process may have retired this record, or the record is unreadable.
  }
  return undefined;
}

function readRecords(
  dir: string,
  workspace: string,
): Map<string, WorkspaceObservation> {
  const records = new Map<string, WorkspaceObservation>();
  for (const name of observationNames(dir)) {
    const item = readObservation(dir, name, workspace);
    if (item) records.set(name, item);
  }
  return records;
}

function workspaceText(text: string, redact: boolean): string {
  const sanitized = sanitizeTerminalText(text);
  return redact ? redactSecrets(sanitized) : sanitized;
}

export function readWorkspaceObservations(
  workspace: string,
  config: WorkspaceMemoryOptions,
): WorkspaceObservation[] {
  try {
    const dir = memoryDir(workspace, false);
    if (!dir) return [];
    return [...readRecords(dir, workspace)]
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, config.maxObservations)
      .map(([, item]) => ({
        ...item,
        text: workspaceText(item.text, config.redactSecrets),
      }));
  } catch {
    return [];
  }
}

export function appendWorkspaceObservations(
  workspace: string,
  sessionOrigin: string,
  observations: readonly Observation[],
  config: WorkspaceMemoryOptions,
): number {
  const pending = new Map<string, WorkspaceObservation>();
  if (!sessionOrigin.trim()) return 0;
  for (const { id, text, relevance, createdAt } of observations) {
    const stored = workspaceText(text, config.redactSecrets)
      .trim()
      .slice(0, MAX_OBSERVATION_CHARS);
    if (
      !id.trim() ||
      !stored ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 1 ||
      !Number.isFinite(relevance)
    ) {
      continue;
    }
    const observation = {
      id,
      text: stored,
      relevance,
      createdAt,
      workspace,
      sessionOrigin,
      redacted: config.redactSecrets,
    };
    pending.set(observationName(observation), observation);
  }
  if (pending.size === 0) return 0;
  const dir = memoryDir(workspace, true);
  if (!dir) throw new Error("workspace memory directory is unavailable");
  try {
    writeFileSync(join(dir, ".gitignore"), "*\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const existing = readRecords(dir, workspace);
  const retained = [...new Set([...existing.keys(), ...pending.keys()])]
    .sort()
    .slice(-config.maxObservations);
  let added = 0;
  for (const name of retained) {
    const observation = pending.get(name);
    if (!observation || existing.has(name)) continue;
    const data = JSON.stringify(observation);
    if (Buffer.byteLength(data) > MAX_RECORD_BYTES) continue;
    const temporary = join(dir, `.${randomUUID()}.tmp`);
    const target = join(dir, name);
    const fd = openSync(temporary, "wx", 0o600);
    try {
      try {
        writeFileSync(fd, data);
      } finally {
        closeSync(fd);
      }
      try {
        // Publish a complete record without replacing a concurrent or repeated write.
        linkSync(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (readObservation(dir, name, workspace)) continue;
        // A malformed record cannot reserve this observation's identity.
        renameSync(temporary, target);
      }
      added++;
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  // Re-list after publishing so retention accounts for concurrent appends.
  const overflow = [...readRecords(dir, workspace).keys()]
    .sort()
    .slice(0, -config.maxObservations);
  for (const name of overflow) rmSync(join(dir, name), { force: true });
  return added;
}
