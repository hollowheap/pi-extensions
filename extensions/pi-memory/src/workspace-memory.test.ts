import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function pi() {
  return {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    getCommands: vi.fn(() => []),
    appendEntry: vi.fn(),
  };
}

describe("workspace memory seams", () => {
  it("S195 C01: resolves nearest project marker, not just git root", () => {
    const base = mkdtempSync(join(tmpdir(), "mem-workspace-"));
    const repo = join(base, "repo");
    const nested = join(repo, "module");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(nested, ".pi"), { recursive: true });
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    extension(pi() as never);
    // Public seam: a resolver export that returns the workspace root.
    const resolveWorkspaceRoot = (
      extension as unknown as {
        resolveWorkspaceRoot?: (cwd: string) => string;
      }
    ).resolveWorkspaceRoot;
    expect(resolveWorkspaceRoot).toBeDefined();
    expect(resolveWorkspaceRoot?.(nested)).toBe(nested);
  });

  it("S196 C01: exposes a codemode-only workspace recall tool", () => {
    const p = pi();
    extension(p as never);
    const tools = p.registerTool.mock.calls.map(
      (call: unknown[]) => call[0] as { name?: string; exposure?: string },
    );
    const recall = tools.find((t) => t.name === "memory_recall");
    expect(recall).toBeDefined();
    expect(recall?.exposure).toBe("codemode");
  });

  it("S197 C01: workspace memory entries carry origin metadata", () => {
    const base = mkdtempSync(join(tmpdir(), "mem-origin-"));
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    const p = pi();
    extension(p as never);
    // Public seam: entries appended for workspace memory include origin fields.
    const appended = p.appendEntry.mock.calls.map((c: unknown[]) => c[1]);
    expect(appended.length).toBeGreaterThan(0);
    expect(appended[0]).toEqual(
      expect.objectContaining({
        workspace: expect.any(String),
        origin: expect.any(String),
      }),
    );
  });
});
