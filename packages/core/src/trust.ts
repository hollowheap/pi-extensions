import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatFsPermissionError, isPermissionError } from "./config.js";
import type { Verdict } from "./types.js";

export interface TrustedRootTag {
  path: string;
  tags: readonly string[];
}

export type TrustedRoot = string | TrustedRootTag;

export interface GuardTrust {
  trustedRoots: readonly TrustedRoot[];
  persistentDecisions: Readonly<Record<string, Verdict>>;
}

const EMPTY_TRUST: GuardTrust = Object.freeze({
  trustedRoots: Object.freeze([]),
  persistentDecisions: Object.freeze({}),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTrustedRoot(value: unknown): TrustedRoot | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined;
  }
  if (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.trim().length > 0 &&
    Array.isArray(value.tags)
  ) {
    const tags = value.tags.filter(
      (tag: unknown): tag is string =>
        typeof tag === "string" && tag.trim().length > 0,
    );
    return Object.freeze({
      path: value.path,
      tags: Object.freeze(tags),
    });
  }
  return undefined;
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
    ? value.trustedRoots
        .map(parseTrustedRoot)
        .filter((root): root is TrustedRoot => root !== undefined)
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

function seedGuardTrust(agentDir: string): GuardTrust {
  const root: TrustedRootTag = { path: agentDir, tags: ["read", "search"] };
  const trust: GuardTrust = Object.freeze({
    trustedRoots: Object.freeze([
      Object.freeze({
        path: agentDir,
        tags: Object.freeze(["read", "search"]),
      }),
    ]),
    persistentDecisions: Object.freeze({}),
  });
  try {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "guard.json"),
      JSON.stringify({ trustedRoots: [root], decisions: {} }, null, 2),
    );
  } catch {
    // Best effort: the in-memory seed still applies when the agent dir is read-only.
  }
  return trust;
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
      return seedGuardTrust(agentDir);
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
