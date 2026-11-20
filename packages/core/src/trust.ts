import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type UpdateJsonConfigResult,
  formatFsPermissionError,
  isPermissionError,
  parseJsonObject,
  updateJsonConfig,
} from "./config.js";
import { errorMessage } from "./format.js";
import { isRecord } from "./records.js";
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
    if ((error as { code?: unknown }).code === "ENOENT") {
      return seedGuardTrust(agentDir);
    }
    const detail = isPermissionError(error)
      ? formatFsPermissionError("read guard trust file", path, error)
      : `${path}: ${errorMessage(error)}`;
    onDiagnostic?.(detail);
    return EMPTY_TRUST;
  }
  const diagnostics: string[] = [];
  const parsed = parseJsonObject(raw, path, diagnostics);
  for (const message of diagnostics) {
    onDiagnostic?.(message);
  }
  if (parsed === undefined) {
    return EMPTY_TRUST;
  }
  return parseGuardTrust(parsed, path, onDiagnostic);
}

export type PersistenceScope = "session" | "indefinite";
export type DecisionEffect = Verdict;

export interface GuardTrustConfig {
  trustedRoots?: TrustedRoot[];
  decisions?: Record<string, DecisionEffect>;
}

export function saveGuardTrust(
  agentDir: string,
  config: GuardTrustConfig,
): UpdateJsonConfigResult {
  return updateJsonConfig(join(agentDir, "guard.json"), (root) => {
    root.trustedRoots = config.trustedRoots ?? [];
    root.decisions = config.decisions ?? {};
  });
}

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Resolves the canonical path, following symlinks if existing.
 * For non-existent child files, resolves the parent directory's realpath.
 */
export function resolveCanonicalPath(
  baseRoot: string,
  targetPath: string,
): string {
  const resolved = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(baseRoot, targetPath);

  const real = tryRealpath(resolved);
  if (real !== undefined) return real;

  // Walk up to find the closest existing ancestor to resolve symlinks
  let current = resolved;
  const trailingParts: string[] = [];

  while (current !== "/" && current !== "." && current !== "") {
    const parent = resolve(current, "..");
    const baseName = current.slice(
      parent.length + (parent.endsWith(sep) ? 0 : 1),
    );
    trailingParts.unshift(baseName);
    current = parent;

    const ancestorReal = tryRealpath(current);
    if (ancestorReal !== undefined) {
      return resolve(ancestorReal, ...trailingParts);
    }
  }

  return resolved;
}

/**
 * Checks whether targetPath is within root, strictly blocking ../ traversal and symlink escapes.
 */
export function isSubpath(
  root: string,
  targetPath: string,
  baseRoot = process.cwd(),
): boolean {
  try {
    const canonicalRoot = resolveCanonicalPath(baseRoot, root);
    const canonicalTarget = resolveCanonicalPath(canonicalRoot, targetPath);
    const rel = relative(canonicalRoot, canonicalTarget);
    return (
      rel === "" ||
      (!rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    );
  } catch {
    return false;
  }
}

function mostSpecificDecision(
  entries: Iterable<[string, DecisionEffect]>,
  target: string,
  baseRoot: string,
): DecisionEffect | undefined {
  let bestPath: string | undefined;
  let best: DecisionEffect | undefined;
  for (const [decidedPath, effect] of entries) {
    if (!isSubpath(decidedPath, target, baseRoot)) continue;
    if (bestPath === undefined || decidedPath.length > bestPath.length) {
      bestPath = decidedPath;
      best = effect;
    } else if (
      decidedPath.length === bestPath.length &&
      effect !== "allow" &&
      best === "allow"
    ) {
      best = effect;
    }
  }
  return best;
}

export interface PathTrustVerdict {
  isOutsideWorkspace: boolean;
  isTrusted: boolean;
  canonicalPath: string;
  cachedDecision?: DecisionEffect;
}

function resolveCachedDecision(
  canonicalTarget: string,
  workspaceRoot: string,
  sources: ReadonlyArray<Iterable<[string, DecisionEffect]> | undefined>,
  exactLookups: ReadonlyArray<
    ((key: string) => DecisionEffect | undefined) | undefined
  >,
): DecisionEffect | undefined {
  for (const lookup of exactLookups) {
    const exact = lookup?.(canonicalTarget);
    if (exact !== undefined) return exact;
  }
  for (const entries of sources) {
    if (entries === undefined) continue;
    const match = mostSpecificDecision(entries, canonicalTarget, workspaceRoot);
    if (match !== undefined) return match;
  }
  return undefined;
}

/**
 * Evaluates whether targetPath is in workspace, a trusted root, or has a cached decision.
 */
export function checkPathTrust(
  targetPath: string,
  workspaceRoot: string,
  trustedRoots: readonly string[] = [],
  sessionDecisions?: ReadonlyMap<string, DecisionEffect>,
  persistentDecisions?: Readonly<Record<string, DecisionEffect>>,
): PathTrustVerdict {
  const canonicalTarget = resolveCanonicalPath(workspaceRoot, targetPath);
  const inWorkspace = isSubpath(workspaceRoot, canonicalTarget);

  const cachedDecision = resolveCachedDecision(
    canonicalTarget,
    workspaceRoot,
    [
      sessionDecisions?.entries(),
      persistentDecisions ? Object.entries(persistentDecisions) : undefined,
    ],
    [
      sessionDecisions ? (key) => sessionDecisions.get(key) : undefined,
      persistentDecisions ? (key) => persistentDecisions[key] : undefined,
    ],
  );

  // Deny ALWAYS holds, even when parent directory is trusted or allowed!
  if (cachedDecision === "deny") {
    return {
      isOutsideWorkspace: !inWorkspace,
      isTrusted: false,
      canonicalPath: canonicalTarget,
      cachedDecision: "deny",
    };
  }

  if (inWorkspace) {
    return {
      isOutsideWorkspace: false,
      isTrusted: true,
      canonicalPath: canonicalTarget,
      cachedDecision,
    };
  }

  // Check if inside any configured trusted root (including symlinks whose
  // link path lives inside a trusted root, e.g. home-manager -> /nix/store).
  const logicalTarget = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(workspaceRoot, targetPath);
  for (const root of trustedRoots) {
    if (
      isSubpath(root, canonicalTarget, workspaceRoot) ||
      isSubpath(root, logicalTarget, workspaceRoot)
    ) {
      return {
        isOutsideWorkspace: true,
        isTrusted: true,
        canonicalPath: canonicalTarget,
        cachedDecision: cachedDecision ?? "allow",
      };
    }
  }

  return {
    isOutsideWorkspace: true,
    isTrusted: cachedDecision === "allow",
    canonicalPath: canonicalTarget,
    cachedDecision,
  };
}

/**
 * Persists an allow/ask/deny decision either for this session or indefinitely in guard.json.
 */
export function persistGuardDecision(
  agentDir: string,
  canonicalPath: string,
  effect: DecisionEffect,
  scope: PersistenceScope,
  sessionCache?: Map<string, DecisionEffect>,
  onNotify?: (message: string, type?: "info" | "warning" | "error") => void,
): void {
  if (scope !== "session" && scope !== "indefinite") {
    throw new Error(`Invalid persistence scope: ${String(scope)}`);
  }

  // Always keep decision in memory sessionCache so active session honours it
  sessionCache?.set(canonicalPath, effect);

  if (scope === "session") {
    return;
  }

  const isDir = (() => {
    try {
      return statSync(canonicalPath).isDirectory();
    } catch {
      return false;
    }
  })();

  const trust = loadGuardTrust(agentDir);
  const decisions = { ...trust.persistentDecisions };
  decisions[canonicalPath] = effect;

  const trustedRoots = [...trust.trustedRoots];
  if (effect === "allow" && isDir && !trustedRoots.includes(canonicalPath)) {
    trustedRoots.push(canonicalPath);
  } else if (effect === "deny") {
    // If explicitly denied, remove from trustedRoots if present
    const idx = trustedRoots.indexOf(canonicalPath);
    if (idx >= 0) {
      trustedRoots.splice(idx, 1);
    }
  }

  const res = saveGuardTrust(agentDir, {
    trustedRoots,
    decisions,
  });

  if (!res.ok) {
    onNotify?.(`pi-guard: ${res.error}`, "error");
  }
}
