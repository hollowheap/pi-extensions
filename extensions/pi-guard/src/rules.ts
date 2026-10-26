import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadGuardConfig, saveGuardConfig } from "./config.js";

export type PersistenceScope = "session" | "indefinite";
export type DecisionEffect = "allow" | "ask" | "deny";

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
export function isSubpath(root: string, targetPath: string): boolean {
  try {
    const canonicalRoot = resolveCanonicalPath(process.cwd(), root);
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

export interface PathTrustVerdict {
  isOutsideWorkspace: boolean;
  isTrusted: boolean;
  canonicalPath: string;
  cachedDecision?: DecisionEffect;
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

  if (inWorkspace) {
    return {
      isOutsideWorkspace: false,
      isTrusted: true,
      canonicalPath: canonicalTarget,
    };
  }

  // Check if inside any configured trusted root
  for (const root of trustedRoots) {
    if (isSubpath(root, canonicalTarget)) {
      return {
        isOutsideWorkspace: true,
        isTrusted: true,
        canonicalPath: canonicalTarget,
      };
    }
  }

  // Check cached decisions: exact match first
  let cachedDecision: DecisionEffect | undefined =
    sessionDecisions?.get(canonicalTarget);
  if (cachedDecision === undefined && persistentDecisions) {
    cachedDecision = persistentDecisions[canonicalTarget];
  }

  // Subpath match on cached decisions (e.g. whole directory was allowed/denied)
  if (cachedDecision === undefined && sessionDecisions) {
    for (const [decidedPath, effect] of sessionDecisions.entries()) {
      if (isSubpath(decidedPath, canonicalTarget)) {
        cachedDecision = effect;
        break;
      }
    }
  }

  if (cachedDecision === undefined && persistentDecisions) {
    for (const [decidedPath, effect] of Object.entries(persistentDecisions)) {
      if (isSubpath(decidedPath, canonicalTarget)) {
        cachedDecision = effect;
        break;
      }
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
export function persistDecision(
  agentDir: string,
  canonicalPath: string,
  effect: DecisionEffect,
  scope: PersistenceScope,
  sessionCache?: Map<string, DecisionEffect>,
): void {
  if (scope !== "session" && scope !== "indefinite") {
    throw new Error(`Invalid persistence scope: ${String(scope)}`);
  }

  if (scope === "session") {
    sessionCache?.set(canonicalPath, effect);
    return;
  }

  const config = loadGuardConfig(agentDir);
  const decisions = { ...(config.decisions ?? {}) };
  decisions[canonicalPath] = effect;

  const trustedRoots = [...(config.trustedRoots ?? [])];
  if (effect === "allow" && !trustedRoots.includes(canonicalPath)) {
    trustedRoots.push(canonicalPath);
  } else if (effect === "deny") {
    // If explicitly denied, remove from trustedRoots if present
    const idx = trustedRoots.indexOf(canonicalPath);
    if (idx >= 0) {
      trustedRoots.splice(idx, 1);
    }
  }

  saveGuardConfig(agentDir, {
    ...config,
    trustedRoots,
    decisions,
  });
}
