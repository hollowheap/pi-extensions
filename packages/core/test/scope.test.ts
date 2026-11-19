import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { evaluate, registerMode } from "../src/modes.js";
import {
  findAncestorMatch,
  isSameWorkspace,
  isWithinWorkspace,
  resolveScopedPath,
  resolveWorkspaceTarget,
} from "../src/scope.js";
import { dropSession, setCwd, setMode } from "../src/state.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe("core workspace scoping helpers", () => {
  it("resolves relative paths against effectiveCwd and preserves absolute paths", () => {
    const owner = {};
    expect(resolveScopedPath("/work", "src/a.ts", owner)).toBe(
      "/work/src/a.ts",
    );
    setCwd(owner, "/work/sub");
    expect(resolveScopedPath("/work", "src/a.ts", owner)).toBe(
      "/work/sub/src/a.ts",
    );
    expect(resolveScopedPath("/work", "/etc/hosts", owner)).toBe("/etc/hosts");
    dropSession(owner);
  });

  it("checks containment and workspace identity across symlinks", () => {
    const root = tempDir("core-scope-ws-");
    const outside = tempDir("core-scope-out-");
    const insideDir = join(root, "sub");
    mkdirSync(insideDir, { recursive: true });
    const escapeLink = join(root, "escape");
    const aliasLink = join(outside, "ws-alias");
    symlinkSync(outside, escapeLink);
    symlinkSync(root, aliasLink);

    expect(isWithinWorkspace(root, join(insideDir, "file.ts"))).toBe(true);
    expect(isWithinWorkspace(root, join(escapeLink, "file.ts"))).toBe(false);
    expect(isWithinWorkspace(root, join(root, "..", "other"))).toBe(false);

    expect(isSameWorkspace(root, aliasLink)).toBe(true);
    expect(isSameWorkspace(root, outside)).toBe(false);
    expect(isSameWorkspace(root, undefined)).toBe(false);
    expect(isSameWorkspace("", root)).toBe(false);
  });

  it("resolveWorkspaceTarget reports effectiveRoot, canonicalPath, and containment", () => {
    const root = tempDir("core-scope-target-");
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    const owner = {};
    setCwd(owner, sub);

    const inside = resolveWorkspaceTarget({
      workspaceRoot: root,
      targetPath: "file.txt",
      owner,
    });
    expect(inside).toEqual({
      effectiveRoot: sub,
      absolutePath: join(sub, "file.txt"),
      canonicalPath: join(realpathSync(sub), "file.txt"),
      inWorkspace: true,
    });

    const outside = resolveWorkspaceTarget({
      workspaceRoot: root,
      targetPath: "../../escape.txt",
      owner,
    });
    expect(outside.inWorkspace).toBe(false);
    dropSession(owner);
  });

  it("findAncestorMatch walks upward and supports canonical and includeRoot options", () => {
    const base = tempDir("core-scope-ancestor-");
    const nested = join(base, "a", "b");
    mkdirSync(join(base, ".marker"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(base, ".marker", "flag"), "1");

    expect(
      findAncestorMatch(nested, (dir) =>
        dir === base ? join(dir, ".marker") : undefined,
      ),
    ).toBe(join(base, ".marker"));

    const alias = join(tempDir("core-scope-alias-"), "link");
    symlinkSync(nested, alias);
    expect(
      findAncestorMatch(
        alias,
        (dir) => (dir === realpathSync(base) ? dir : undefined),
        { canonical: true, includeRoot: false },
      ),
    ).toBe(realpathSync(base));
  });

  it("evaluate resolves relative targets against effectiveCwd consistently", () => {
    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    const allow = [
      { tag: "edit" as const, pattern: "*", effect: "allow" as const },
    ];
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "artifacts/plan.md",
        rules: allow,
      }),
    ).toBe("ask");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: allow,
      }),
    ).toBe("deny");
    dropSession(owner);
  });
});
