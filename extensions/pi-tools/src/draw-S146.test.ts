import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPathDenied } from "./permissions.js";

const state = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

describe("S146 path policy check", () => {
  it("denies a path matching a deny rule while leaving an allowed path available", () => {
    const dir = mkdtempSync(join(tmpdir(), "s146-tools-"));
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
});
