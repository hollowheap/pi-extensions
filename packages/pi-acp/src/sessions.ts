import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface SessionRecord {
  sessionId: string;
  cwd: string;
  piSessionFile: string;
  title: string;
  updatedAt: string;
  agent: "hollowheap-pi-acp";
}

export function loadStore(path: string): SessionRecord[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(
      `[pi-acp] failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is SessionRecord =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as SessionRecord).sessionId === "string" &&
      typeof (entry as SessionRecord).cwd === "string" &&
      typeof (entry as SessionRecord).piSessionFile === "string",
  );
}

export function saveStore(path: string, records: SessionRecord[]): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.sessions.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    writeFileSync(tmpPath, `${JSON.stringify(records, null, 2)}\n`);
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw error;
  }
}
