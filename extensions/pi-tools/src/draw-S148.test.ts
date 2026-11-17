import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

describe("S148 /cd-only exposure", () => {
  it("registers only the /cd command and keeps its containment guard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s148-tools-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "permissions.json"),
      JSON.stringify({ rules: ["allow read *", "allow edit *"] }),
    );
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    const commands = Object.fromEntries(
      pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
    );
    const branch: unknown[] = [];
    const ctx = {
      cwd: dir,
      sessionManager: {
        getBranch: vi.fn(() => branch),
        appendCustomEntry: vi.fn(),
      },
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { setStatus: vi.fn(), notify: vi.fn(), confirm: vi.fn() },
    };

    expect(Object.keys(commands)).toEqual(["cd"]);
    await commands.cd.handler("/etc", ctx as never);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("outside project root"),
      "error",
    );
  });
});
