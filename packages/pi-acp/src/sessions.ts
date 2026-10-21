import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
  const parsed: unknown = JSON.parse(raw);
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`);
}
