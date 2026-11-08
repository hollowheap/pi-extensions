import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGuardConfig, saveGuardConfig } from "./config.js";
import {
  checkPathTrust,
  isSubpath,
  persistDecision,
  resolveCanonicalPath,
} from "./rules.js";

describe("out-of-workspace root trust rules", () => {
  let tempBase: string;
  let workspaceDir: string;
  let externalDir: string;
  let agentDir: string;

  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), "pi-guard-rules-test-"));
    workspaceDir = join(tempBase, "workspace");
    externalDir = join(tempBase, "external");
    agentDir = join(tempBase, "agent");

    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(externalDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch {}
  });

  describe("isSubpath & path traversal", () => {
    it("recognizes paths inside workspace", () => {
      const file = join(workspaceDir, "src", "index.ts");
      expect(isSubpath(workspaceDir, file)).toBe(true);
      expect(isSubpath(workspaceDir, workspaceDir)).toBe(true);
    });

    it("rejects path traversal attempting to escape root", () => {
      const traversal = join(workspaceDir, "..", "external", "file.txt");
      expect(isSubpath(workspaceDir, traversal)).toBe(false);
      expect(isSubpath(workspaceDir, "/etc/passwd")).toBe(false);
    });

    it("detects symlink escapes pointing outside root", () => {
      const symlinkPath = join(workspaceDir, "escape-link");
      try {
        symlinkSync(externalDir, symlinkPath);
      } catch {
        // Skip symlink test if filesystem does not permit symlinks
        return;
      }
      expect(isSubpath(workspaceDir, symlinkPath)).toBe(false);
      expect(isSubpath(workspaceDir, join(symlinkPath, "subfile"))).toBe(false);
    });
  });

  describe("checkPathTrust", () => {
    it("allows in-workspace paths unconditionally", () => {
      const target = join(workspaceDir, "a.txt");
      const result = checkPathTrust(target, workspaceDir);
      expect(result.isOutsideWorkspace).toBe(false);
      expect(result.isTrusted).toBe(true);
    });

    it("marks out-of-workspace path as untrusted by default", () => {
      const target = join(externalDir, "data.txt");
      const result = checkPathTrust(target, workspaceDir, []);
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.isTrusted).toBe(false);
      expect(result.cachedDecision).toBeUndefined();
    });

    it("marks out-of-workspace path as trusted if covered by trustedRoots", () => {
      const target = join(externalDir, "data.txt");
      const result = checkPathTrust(target, workspaceDir, [externalDir]);
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.isTrusted).toBe(true);
    });

    it("resolves relative trusted roots against the workspace", () => {
      const target = join(externalDir, "data.txt");
      const result = checkPathTrust(target, workspaceDir, ["../external"]);
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.isTrusted).toBe(true);
    });

    it("uses the most specific cached subpath decision", () => {
      const target = join(externalDir, "dir", "file.txt");
      const sessionDecisions = new Map<string, "allow" | "ask" | "deny">([
        [resolveCanonicalPath(workspaceDir, externalDir), "allow"],
        [resolveCanonicalPath(workspaceDir, join(externalDir, "dir")), "deny"],
      ]);
      const result = checkPathTrust(target, workspaceDir, [], sessionDecisions);
      expect(result.cachedDecision).toBe("deny");
      expect(result.isTrusted).toBe(false);
    });

    it("uses cached session decision if present", () => {
      const target = join(externalDir, "file.txt");
      const sessionDecisions = new Map<string, "allow" | "ask" | "deny">([
        [resolveCanonicalPath(workspaceDir, target), "allow"],
      ]);
      const result = checkPathTrust(target, workspaceDir, [], sessionDecisions);
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.isTrusted).toBe(true);
      expect(result.cachedDecision).toBe("allow");
    });

    it("uses persistent decisions if session decision is missing", () => {
      const target = join(externalDir, "blocked.txt");
      const canon = resolveCanonicalPath(workspaceDir, target);
      const persistentDecisions: Record<string, "allow" | "ask" | "deny"> = {
        [canon]: "deny",
      };
      const result = checkPathTrust(
        target,
        workspaceDir,
        [],
        undefined,
        persistentDecisions,
      );
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.isTrusted).toBe(false);
      expect(result.cachedDecision).toBe("deny");
    });

    it("upholds cached deny on child path even if parent is in trustedRoots", () => {
      const child = join(externalDir, "forbidden.txt");
      const sessionDecisions = new Map<string, "allow" | "ask" | "deny">([
        [resolveCanonicalPath(workspaceDir, child), "deny"],
      ]);
      const result = checkPathTrust(
        child,
        workspaceDir,
        [externalDir],
        sessionDecisions,
      );
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.cachedDecision).toBe("deny");
      expect(result.isTrusted).toBe(false);
    });

    it("upholds persistent deny on child path even if parent is in trustedRoots", () => {
      const child = join(externalDir, "forbidden.txt");
      const canon = resolveCanonicalPath(workspaceDir, child);
      const persistentDecisions: Record<string, "allow" | "ask" | "deny"> = {
        [canon]: "deny",
      };
      const result = checkPathTrust(
        child,
        workspaceDir,
        [externalDir],
        undefined,
        persistentDecisions,
      );
      expect(result.isOutsideWorkspace).toBe(true);
      expect(result.cachedDecision).toBe("deny");
      expect(result.isTrusted).toBe(false);
    });
  });

  describe("persistDecision", () => {
    it("saves session decision to session map without modifying guard.json", () => {
      const sessionCache = new Map<string, "allow" | "ask" | "deny">();
      const target = join(externalDir, "session-only.txt");
      persistDecision(agentDir, target, "allow", "session", sessionCache);

      expect(sessionCache.get(target)).toBe("allow");
      const savedConfig = loadGuardConfig(agentDir);
      expect(savedConfig.decisions?.[target]).toBeUndefined();
    });

    it("saves indefinite decision to guard.json and adds to trustedRoots if allowed directory", () => {
      const target = join(externalDir, "allowed-dir");
      mkdirSync(target, { recursive: true });

      persistDecision(agentDir, target, "allow", "indefinite");

      const savedConfig = loadGuardConfig(agentDir);
      expect(savedConfig.decisions?.[target]).toBe("allow");
      expect(savedConfig.trustedRoots).toContain(target);
    });

    it("does not add file to trustedRoots when allowed indefinitely", () => {
      const target = join(externalDir, "allowed-file.txt");
      writeFileSync(target, "content");

      persistDecision(agentDir, target, "allow", "indefinite");

      const savedConfig = loadGuardConfig(agentDir);
      expect(savedConfig.decisions?.[target]).toBe("allow");
      expect(savedConfig.trustedRoots ?? []).not.toContain(target);
    });

    it("removes from trustedRoots when denied indefinitely", () => {
      const target = join(externalDir, "denied-dir");
      saveGuardConfig(agentDir, {
        trustedRoots: [target],
        decisions: {},
      });

      persistDecision(agentDir, target, "deny", "indefinite");

      const savedConfig = loadGuardConfig(agentDir);
      expect(savedConfig.decisions?.[target]).toBe("deny");
      expect(savedConfig.trustedRoots).not.toContain(target);
    });

    it("throws an error when invalid persistence scope is provided", () => {
      expect(() =>
        persistDecision(
          agentDir,
          "/some/path",
          "allow",
          "invalid-scope" as never,
        ),
      ).toThrow("Invalid persistence scope");
    });

    it("keeps decision in sessionCache and leaves guard.json untouched when guard.json is invalid JSON", () => {
      const guardPath = join(agentDir, "guard.json");
      const malformedJson = "{ invalid json content ...";
      writeFileSync(guardPath, malformedJson, "utf-8");

      const sessionCache = new Map<string, "allow" | "ask" | "deny">();
      const target = join(externalDir, "allowed-dir");
      mkdirSync(target, { recursive: true });
      const onNotify = vi.fn();

      persistDecision(
        agentDir,
        target,
        "allow",
        "indefinite",
        sessionCache,
        onNotify,
      );

      expect(sessionCache.get(target)).toBe("allow");
      expect(readFileSync(guardPath, "utf-8")).toBe(malformedJson);
      expect(onNotify).toHaveBeenCalledWith(
        expect.stringContaining("not valid JSON"),
        "error",
      );
    });
  });

  describe("saveGuardConfig", () => {
    it("returns error result and leaves file unchanged if guard.json has invalid JSON", () => {
      const guardPath = join(agentDir, "guard.json");
      const malformed = "{ broken";
      writeFileSync(guardPath, malformed, "utf-8");

      const res = saveGuardConfig(agentDir, { trustedRoots: ["/foo"] });
      expect(res.ok).toBe(false);
      expect(readFileSync(guardPath, "utf-8")).toBe(malformed);
    });
  });
});
