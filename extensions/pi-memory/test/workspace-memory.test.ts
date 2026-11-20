import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

function pi() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return () => {};
    }),
    handlers,
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    getCommands: vi.fn(() => []),
    appendEntry: vi.fn(),
  };
}

describe("workspace memory seams", () => {
  it("resolves nearest project marker, not just git root", () => {
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

  it("exposes a codemode-only workspace recall tool", () => {
    const p = pi();
    extension(p as never);
    const tools = p.registerTool.mock.calls.map(
      (call: unknown[]) => call[0] as { name?: string; exposure?: string },
    );
    const recall = tools.find((t) => t.name === "recall");
    expect(recall).toBeDefined();
    expect(recall?.exposure).toBe("direct");
  });

  it("workspace memory entries carry origin metadata", () => {
    const base = mkdtempSync(join(tmpdir(), "mem-origin-"));
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    const p = pi();
    extension(p as never);
    // Public seam: workspace entry is appended at session start, never at load.
    expect(p.appendEntry).not.toHaveBeenCalled();
    p.handlers.get("session_start")?.({}, {});
    const appended = p.appendEntry.mock.calls.map((c: unknown[]) => c[1]);
    expect(appended.length).toBeGreaterThan(0);
    expect(appended[0]).toEqual(
      expect.objectContaining({
        workspace: expect.any(String),
        origin: expect.any(String),
      }),
    );
  });

  it("a git marker alone identifies the workspace root", () => {
    const { resolveWorkspaceRoot } = extension as unknown as {
      resolveWorkspaceRoot: (cwd: string) => string;
    };
    const base = mkdtempSync(join(tmpdir(), "mem-gitroot-"));
    const repo = join(base, "repo");
    const nested = join(repo, "module");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    expect(resolveWorkspaceRoot(nested)).toBe(repo);
  });

  it("a marker in the cwd itself is the workspace root", () => {
    const { resolveWorkspaceRoot } = extension as unknown as {
      resolveWorkspaceRoot: (cwd: string) => string;
    };
    const dir = mkdtempSync(join(tmpdir(), "mem-cwdmarker-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    expect(resolveWorkspaceRoot(dir)).toBe(dir);
  });

  it("the extension publishes the resolver and a workspace entry", () => {
    const { resolveWorkspaceRoot } = extension as unknown as {
      resolveWorkspaceRoot: (cwd: string) => string;
    };
    const base = mkdtempSync(join(tmpdir(), "mem-publish-"));
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    const p = pi();
    extension(p as never);
    p.handlers.get("session_start")?.({}, {});
    expect(resolveWorkspaceRoot).toBeTypeOf("function");
    expect(p.appendEntry).toHaveBeenCalled();
  });

  it("the recall tool supports session and workspace scope", () => {
    const p = pi();
    extension(p as never);
    const recall = p.registerTool.mock.calls
      .map(
        (call: unknown[]) => call[0] as { name?: string; description?: string },
      )
      .find((t) => t.name === "recall");
    expect(recall?.description).toContain("session");
    expect(recall?.description).toContain("workspace");
  });

  it("the memory command is registered alongside the tools", () => {
    const p = pi();
    extension(p as never);
    expect(p.registerCommand.mock.calls.map((c: unknown[]) => c[0])).toContain(
      "memory",
    );
    expect(p.registerTool.mock.calls.length).toBeGreaterThan(0);
  });

  it("the workspace entry carries redaction and creation fields", () => {
    const base = mkdtempSync(join(tmpdir(), "mem-fields-"));
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    const p = pi();
    extension(p as never);
    p.handlers.get("session_start")?.({}, {});
    const entry = p.appendEntry.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(entry).toEqual(
      expect.objectContaining({
        redacted: expect.any(Boolean),
        createdAt: expect.any(Number),
        sessionOrigin: expect.any(String),
      }),
    );
  });

  it("exactly one workspace entry is appended per registration", () => {
    const base = mkdtempSync(join(tmpdir(), "mem-single-"));
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    const p = pi();
    extension(p as never);
    p.handlers.get("session_start")?.({}, {});
    const workspaceEntries = p.appendEntry.mock.calls.filter(
      (c: unknown[]) => c[0] === "hollowheap.memory.workspace",
    );
    expect(workspaceEntries).toHaveLength(1);
  });

  it("the entry workspace matches the published resolver", () => {
    const { resolveWorkspaceRoot } = extension as unknown as {
      resolveWorkspaceRoot: (cwd: string) => string;
    };
    const base = mkdtempSync(join(tmpdir(), "mem-agree-"));
    mkdirSync(join(base, "agent"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = join(base, "agent");
    const p = pi();
    extension(p as never);
    p.handlers.get("session_start")?.({}, {});
    const entry = p.appendEntry.mock.calls[0]?.[1] as { workspace?: string };
    expect(entry.workspace).toBe(resolveWorkspaceRoot(process.cwd()));
  });
});
