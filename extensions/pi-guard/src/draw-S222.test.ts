import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGuardTrust, parseGuardTrust } from "@hollowheap/core/trust";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const agentState = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => agentState.agentDir,
}));

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "draw-s222-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  agentState.agentDir = "/nonexistent-agent-dir";
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function guardToolCall() {
  const pi = {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
  };
  extension(pi as never);
  const call = pi.on.mock.calls.find(([event]) => event === "tool_call");
  return call?.[1] as (
    event: unknown,
    ctx: unknown,
  ) => Promise<{ block?: boolean; reason?: string } | undefined>;
}

describe("S222 tag-scoped trusted roots", () => {
  it("accepts a tag-scoped trusted root object", () => {
    const trust = parseGuardTrust(
      { trustedRoots: [{ path: "/agents", tags: ["read", "search"] }] },
      "guard.json",
    );

    expect(trust.trustedRoots).toHaveLength(1);
    expect(JSON.stringify(trust.trustedRoots[0])).toContain("/agents");
    expect(JSON.stringify(trust.trustedRoots[0])).toContain("read");
    expect(JSON.stringify(trust.trustedRoots[0])).toContain("search");
  });

  it("seeds the agent directory as a read/search root on first run", () => {
    const dir = tempDir();
    const trust = loadGuardTrust(dir);

    expect(trust.trustedRoots.length).toBeGreaterThan(0);
    expect(JSON.stringify(trust.trustedRoots)).toContain(dir);
    expect(JSON.stringify(trust.trustedRoots)).toContain("read");
    expect(JSON.stringify(trust.trustedRoots)).toContain("search");
  });

  it("honours removal of the agent-directory root", async () => {
    const dir = tempDir();
    agentState.agentDir = dir;
    writeFileSync(
      join(dir, "guard.json"),
      JSON.stringify({ trustedRoots: [], decisions: {} }),
    );
    const skillDir = join(dir, "skills", "demo");
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, "SKILL.md");
    writeFileSync(skillFile, "demo");

    const hook = guardToolCall();
    const ctx = {
      cwd: tempDir(),
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(), select: vi.fn() },
    };

    const result = await hook(
      { toolName: "read", input: { path: skillFile } },
      ctx,
    );
    expect(result).toEqual(
      expect.objectContaining({ block: true, reason: expect.any(String) }),
    );
  });
});
