import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPath } from "@hollowheap/core/policy";
import { describe, expect, it, vi } from "vitest";
import { isPathDenied, loadContextPolicy } from "../src/permissions.js";

const state = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

describe("path policy check", () => {
  it("denies a path matching a deny rule while leaving an allowed path available", () => {
    const dir = mkdtempSync(join(tmpdir(), "path-policy-tools-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "permissions.json"),
      JSON.stringify({
        rules: ["allow read *", "allow edit *", "deny read secret/*"],
      }),
    );
    const ctx = {
      cwd: dir,
      sessionManager: { getBranch: vi.fn(() => []) },
      hasUI: true,
      isProjectTrusted: () => true,
    };

    expect(
      isPathDenied(ctx as never, join(dir, "secret", "key.txt"), dir),
    ).toBe(true);
    expect(isPathDenied(ctx as never, join(dir, "public.txt"), dir)).toBe(
      false,
    );
  });

  it("a path outside the project root is denied without a rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "path-policy-outside-"));
    const ctx = {
      cwd: dir,
      sessionManager: { getBranch: vi.fn(() => []) },
      hasUI: true,
      isProjectTrusted: () => true,
    };
    expect(
      isPathDenied(ctx as never, join(dir, "..", "outside.txt"), dir),
    ).toBe(true);
  });

  it("an unreadable config is diagnosed instead of silently trusted", () => {
    const dir = mkdtempSync(join(tmpdir(), "path-policy-badconfig-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "permissions.json"), "{not json");
    const ctx = {
      cwd: dir,
      sessionManager: { getBranch: vi.fn(() => []) },
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    };
    expect(isPathDenied(ctx as never, join(dir, "anything.txt"), dir)).toBe(
      false,
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON"),
      "warning",
    );
  });

  it("the loaded policy rules drive a direct path verdict", () => {
    const dir = mkdtempSync(join(tmpdir(), "path-policy-policy-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "permissions.json"),
      JSON.stringify({ rules: ["allow read *", "deny read secret/*"] }),
    );
    const ctx = {
      cwd: dir,
      sessionManager: { getBranch: vi.fn(() => []) },
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    };
    const { rules } = loadContextPolicy(ctx as never);
    expect(checkPath(rules, join(dir, "secret", "key"), "read", dir)).toBe(
      "deny",
    );
    expect(checkPath(rules, join(dir, "public"), "read", dir)).toBe("allow");
  });
});
