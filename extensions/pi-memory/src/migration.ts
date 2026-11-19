import { constants } from "node:fs";
import { type FileHandle, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  type SessionEntry,
  type SessionHeader,
  migrateSessionEntries,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import {
  MEMORY_CLEAR_TYPE,
  MEMORY_OBSERVATION_TYPE,
  type MemoryObservation,
  parseObservation,
} from "./ledger.js";
import type { MemoryConfig } from "./settings.js";
import {
  appendWorkspaceObservations,
  resolveWorkspaceRoot,
} from "./workspace.js";

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_SESSION_BYTES = 64 * 1024 * 1024;

async function readThrough(
  file: FileHandle,
  buffer: Buffer,
  start = 0,
): Promise<number> {
  let offset = start;
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset;
}

function savedTree(content: string): {
  entries: SessionEntry[];
  branch: SessionEntry[];
} {
  const entries = parseSessionEntries(content);
  // A skipped line could be a branch move or clear record.
  if (
    entries.length !==
      content.split("\n").filter((line) => line.trim()).length ||
    entries.some((entry) => !entry || typeof entry.type !== "string") ||
    entries.slice(1).some((entry) => entry.type === "session")
  ) {
    throw new Error("Incomplete session log");
  }
  migrateSessionEntries(entries);

  const byId = new Map<string, SessionEntry>();
  let leaf: SessionEntry | undefined;
  for (const entry of entries) {
    if (entry.type === "session") continue;
    if (
      typeof entry.id !== "string" ||
      entry.id === "" ||
      byId.has(entry.id) ||
      (entry.parentId !== null && !byId.has(entry.parentId))
    ) {
      throw new Error("Invalid session branch");
    }
    byId.set(entry.id, entry);
    leaf = entry;
  }

  const branch: SessionEntry[] = [];
  while (leaf) {
    branch.push(leaf);
    leaf = leaf.parentId === null ? undefined : byId.get(leaf.parentId);
  }
  return { entries: [...byId.values()], branch: branch.reverse() };
}

interface CurrentSession {
  file: string | undefined;
  id: string;
  branch: readonly SessionEntry[];
}

interface ArchivedObservation {
  entryId: string;
  observation: MemoryObservation;
}

interface Archive {
  header: SessionHeader;
  workspace: string | undefined;
  identity: string;
  active: ArchivedObservation[];
  byEntryId: Map<string, ArchivedObservation>;
  byObservationId: Map<string, ArchivedObservation>;
}

function observationRecord(
  entry: SessionEntry,
  fallbackCreatedAt: number,
): ArchivedObservation | undefined {
  if (entry.type !== "custom" || entry.customType !== MEMORY_OBSERVATION_TYPE) {
    return;
  }
  const observation = parseObservation(entry.data, fallbackCreatedAt);
  if (observation) return { entryId: entry.id, observation };
}

async function readArchive(
  path: string,
  expectedWorkspace: string | undefined,
  current: CurrentSession,
): Promise<Archive | undefined> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0) return;
    const { size } = stat;
    const prefix = Buffer.allocUnsafe(Math.min(size, MAX_HEADER_BYTES));
    if ((await readThrough(file, prefix)) !== prefix.length) {
      throw new Error("Session changed while reading");
    }
    const newline = prefix.indexOf(10);
    if (newline === -1 && prefix.length < size) {
      throw new Error("Oversized session header");
    }
    const firstLine = newline === -1 ? prefix : prefix.subarray(0, newline);
    const [header] = parseSessionEntries(firstLine.toString("utf8"));
    if (
      header?.type !== "session" ||
      typeof header.id !== "string" ||
      !header.id.trim() ||
      typeof header.cwd !== "string" ||
      !isAbsolute(header.cwd) ||
      !Number.isInteger(header.version ?? 1) ||
      (header.version ?? 1) < 1 ||
      (header.version ?? 1) > CURRENT_SESSION_VERSION
    ) {
      throw new Error("Invalid session header");
    }
    const workspace = resolveWorkspaceRoot(header.cwd);
    if (expectedWorkspace !== undefined && workspace !== expectedWorkspace)
      return;
    const timestamp = Date.parse(header.timestamp);
    const fallbackCreatedAt = timestamp > 0 ? timestamp : 1;
    if (size > MAX_SESSION_BYTES) throw new Error("Oversized session log");
    const content = Buffer.allocUnsafe(size);
    prefix.copy(content);
    if ((await readThrough(file, content, prefix.length)) !== size) {
      throw new Error("Session changed while reading");
    }
    const { entries, branch } = savedTree(content.toString("utf8"));
    const byEntryId = new Map<string, ArchivedObservation>();
    const byObservationId = new Map<string, ArchivedObservation>();
    for (const entry of entries) {
      const record = observationRecord(entry, fallbackCreatedAt);
      if (!record) continue;
      byEntryId.set(record.entryId, record);
      if (!byObservationId.has(record.observation.id)) {
        byObservationId.set(record.observation.id, record);
      }
    }

    const selected =
      current.file === path && current.id === header.id
        ? current.branch
        : branch;
    const active = new Map<string, ArchivedObservation>();
    for (const entry of selected) {
      if (entry.type === "custom" && entry.customType === MEMORY_CLEAR_TYPE) {
        active.clear();
      } else {
        const record = observationRecord(entry, fallbackCreatedAt);
        if (record && !active.has(record.observation.id)) {
          active.set(record.observation.id, record);
        }
      }
    }
    return {
      header,
      workspace,
      identity: `${stat.dev}:${stat.ino}`,
      active: [...active.values()],
      byEntryId,
      byObservationId,
    };
  } finally {
    await file.close();
  }
}

async function physicalPath(path: string): Promise<string> {
  // Canonicalize directory aliases while retaining O_NOFOLLOW on the file itself.
  return join(await realpath(dirname(path)), basename(path));
}

function observationOrigin(
  lineage: readonly Archive[],
  record: ArchivedObservation,
): { archive: Archive; observation: MemoryObservation } | undefined {
  let source = record;
  for (const [index, archive] of lineage.entries()) {
    if (archive.header.parentSession === undefined) {
      return { archive, observation: source.observation };
    }
    const parent = lineage[index + 1];
    if (!parent) return;
    // Pi preserves observation IDs when copying entries from an older archive.
    const inherited = parent.byObservationId.get(source.observation.id);
    const inheritedEntry = parent.byEntryId.get(source.entryId);
    if (inheritedEntry?.observation.id === source.observation.id) {
      source = inheritedEntry;
    } else if (inherited) {
      source = inherited;
    } else {
      return { archive, observation: source.observation };
    }
  }
}

async function addArchiveFile(
  files: Set<string>,
  path: string,
): Promise<{ canonical?: string; skipped: number }> {
  try {
    const canonical = await physicalPath(path);
    files.add(canonical);
    return { canonical, skipped: 0 };
  } catch {
    return { skipped: 1 };
  }
}

async function scanSessionDir(
  files: Set<string>,
  directory: string,
  includeCwdDirs = false,
): Promise<number> {
  let dir: Awaited<ReturnType<typeof opendir>>;
  let skipped = 0;
  try {
    dir = await opendir(directory);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT" ? 1 : 0;
  }
  for await (const entry of dir) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const added = await addArchiveFile(files, path);
      skipped += added.skipped;
    } else if (includeCwdDirs && entry.isDirectory()) {
      skipped += await scanSessionDir(files, path);
    }
  }
  return skipped;
}

async function importArchiveObservations(
  archive: Archive,
  files: ReadonlySet<string>,
  workspace: string,
  selected: CurrentSession,
  config: MemoryConfig,
): Promise<{ imported: number; skipped: number }> {
  if (archive.active.length === 0) return { imported: 0, skipped: 0 };
  const lineage = [archive];
  const ancestry = new Set([archive.identity]);
  // Parent paths are untrusted transcript data. Only follow exact discovered archives.
  while (lineage.length < 64) {
    const parentPath = lineage.at(-1)?.header.parentSession;
    if (typeof parentPath !== "string" || !isAbsolute(parentPath)) break;
    try {
      const canonical = await physicalPath(parentPath);
      if (!files.has(canonical)) break;
      const parent = await readArchive(canonical, undefined, selected);
      if (!parent || ancestry.has(parent.identity)) break;
      ancestry.add(parent.identity);
      lineage.push(parent);
    } catch {
      break;
    }
  }
  const byOrigin = new Map<string, MemoryObservation[]>();
  let unverified = false;
  for (const record of archive.active) {
    const origin = observationOrigin(lineage, record);
    if (!origin) {
      unverified = true;
      continue;
    }
    if (origin.archive.workspace !== workspace) continue;
    const id = origin.archive.header.id;
    const observations = byOrigin.get(id) ?? [];
    observations.push(origin.observation);
    byOrigin.set(id, observations);
  }
  let imported = 0;
  for (const [origin, observations] of byOrigin) {
    imported += appendWorkspaceObservations(
      workspace,
      origin,
      observations,
      config,
    );
  }
  return { imported, skipped: unverified ? 1 : 0 };
}

export async function migrateWorkspaceMemory(
  workspace: string,
  agentDir: string,
  sessionDir: string | undefined,
  current: CurrentSession,
  config: MemoryConfig,
): Promise<{ imported: number; skipped: number }> {
  const sessionsRoot = resolve(agentDir, "sessions");
  let imported = 0;
  let skipped = 0;
  const files = new Set<string>();

  let currentFile: string | undefined;
  if (current.file) {
    const added = await addArchiveFile(files, current.file);
    currentFile = added.canonical;
    skipped += added.skipped;
  }
  const selected = { ...current, file: currentFile };
  skipped += await scanSessionDir(files, sessionsRoot, true);
  if (sessionDir && resolve(sessionDir) !== sessionsRoot) {
    skipped += await scanSessionDir(files, resolve(sessionDir));
  }
  const importedArchives = new Set<string>();
  for (const file of files) {
    let archive: Archive | undefined;
    try {
      archive = await readArchive(file, workspace, selected);
    } catch {
      skipped++;
      continue;
    }
    if (!archive || importedArchives.has(archive.identity)) continue;
    importedArchives.add(archive.identity);
    const result = await importArchiveObservations(
      archive,
      files,
      workspace,
      selected,
      config,
    );
    imported += result.imported;
    skipped += result.skipped;
  }
  return { imported, skipped };
}
