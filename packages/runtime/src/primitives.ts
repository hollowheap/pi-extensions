import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function writeJsonAtomic(
  path: string,
  value: unknown,
  options: { tmp?: string; createDir?: boolean } = {},
): void {
  const temporary = options.tmp ?? `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    if (options.createDir) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Best-effort temp cleanup.
    }
    throw error;
  }
}
