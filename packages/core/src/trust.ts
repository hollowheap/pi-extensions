import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatFsPermissionError, isPermissionError } from "./config.js";
import type { Verdict } from "./types.js";

export interface GuardTrust {
  trustedRoots: readonly string[];
  persistentDecisions: Readonly<Record<string, Verdict>>;
}

const EMPTY_TRUST: GuardTrust = Object.freeze({
  trustedRoots: Object.freeze([]),
  persistentDecisions: Object.freeze({}),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGuardTrust(
  value: unknown,
  path: string,
  onDiagnostic?: (message: string) => void,
): GuardTrust {
  if (!isRecord(value)) {
    onDiagnostic?.(`${path} must contain a JSON object; using defaults`);
    return EMPTY_TRUST;
  }
  const trustedRoots = Array.isArray(value.trustedRoots)
    ? value.trustedRoots.filter(
        (root: unknown): root is string =>
          typeof root === "string" && root.trim().length > 0,
      )
    : [];
  const decisions: Record<string, Verdict> = {};
  if (isRecord(value.decisions)) {
    for (const [key, effect] of Object.entries(value.decisions)) {
      if (effect === "allow" || effect === "ask" || effect === "deny") {
        decisions[key] = effect;
      }
    }
  }
  return Object.freeze({
    trustedRoots: Object.freeze(trustedRoots),
    persistentDecisions: Object.freeze(decisions),
  });
}

export function loadGuardTrust(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): GuardTrust {
  const path = join(agentDir, "guard.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return EMPTY_TRUST;
    }
    const message = isPermissionError(error)
      ? formatFsPermissionError("read guard config", path, error)
      : `cannot read ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`;
    onDiagnostic?.(message);
    return EMPTY_TRUST;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    onDiagnostic?.(
      `${path} is not valid JSON (${
        error instanceof Error ? error.message : String(error)
      }); using defaults`,
    );
    return EMPTY_TRUST;
  }
  return parseGuardTrust(parsed, path, onDiagnostic);
}
