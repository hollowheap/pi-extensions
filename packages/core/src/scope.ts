import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { effectiveCwd } from "./state.js";
import { isSubpath, resolveCanonicalPath } from "./trust.js";

export interface WorkspaceTarget {
  effectiveRoot: string;
  absolutePath: string;
  canonicalPath: string;
  inWorkspace: boolean;
}

/**
 * Resolves targetPath relative to the session's effective working directory.
 */
export function resolveScopedPath(
  workspaceRoot: string,
  targetPath: string,
  owner?: unknown,
): string {
  return resolve(effectiveCwd(workspaceRoot, owner), targetPath);
}

/**
 * Checks whether targetPath stays within workspaceRoot after symlink canonicalization.
 */
export function isWithinWorkspace(
  workspaceRoot: string,
  targetPath: string,
  baseRoot = workspaceRoot,
): boolean {
  return isSubpath(workspaceRoot, targetPath, baseRoot);
}

/**
 * Checks whether two workspace paths refer to the same canonical directory.
 */
export function isSameWorkspace(
  left: string | undefined,
  right: string | undefined,
  baseRoot = process.cwd(),
): boolean {
  if (!left || !right) return false;
  return (
    resolveCanonicalPath(baseRoot, left) ===
    resolveCanonicalPath(baseRoot, right)
  );
}

/**
 * Resolves a target path against effectiveCwd and computes its canonical workspace containment.
 */
export function resolveWorkspaceTarget(options: {
  workspaceRoot: string;
  targetPath: string;
  owner?: unknown;
}): WorkspaceTarget {
  const effectiveRoot = effectiveCwd(options.workspaceRoot, options.owner);
  const absolutePath = resolve(effectiveRoot, options.targetPath);
  const canonicalPath = resolveCanonicalPath(
    options.workspaceRoot,
    absolutePath,
  );
  return {
    effectiveRoot,
    absolutePath,
    canonicalPath,
    inWorkspace: isSubpath(
      options.workspaceRoot,
      canonicalPath,
      options.workspaceRoot,
    ),
  };
}

/**
 * Walks upward from startDir until probe returns a defined value.
 */
export function findAncestorMatch<T>(
  startDir: string,
  probe: (dir: string) => T | undefined,
  options: { canonical?: boolean; includeRoot?: boolean } = {},
): T | undefined {
  let current = resolve(startDir);
  if (options.canonical) {
    try {
      current = realpathSync.native(current);
    } catch {
      return undefined;
    }
  }
  const includeRoot = options.includeRoot ?? true;
  for (;;) {
    const parent = dirname(current);
    if (!includeRoot && parent === current) return undefined;
    const match = probe(current);
    if (match !== undefined) return match;
    if (parent === current) return undefined;
    current = parent;
  }
}
