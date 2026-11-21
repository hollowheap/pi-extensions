import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

let capturedComponent:
  | { render(width: number): string[]; handleInput(data: string): void }
  | undefined;

vi.mock("@hollowheap/pi-ui/host", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    showDialog: (
      _ctx: unknown,
      factory: (
        tui: unknown,
        theme: unknown,
        keys: unknown,
        done: (value: undefined) => void,
      ) => { render(width: number): string[]; handleInput(data: string): void },
    ) => {
      capturedComponent = factory(
        { terminal: { rows: 20 }, requestRender: vi.fn() },
        {},
        {},
        () => {},
      );
      return Promise.resolve();
    },
  };
});

import { showSubagentTranscript } from "../src/transcript.js";

function sessionJsonl(text: string): string {
  return [
    {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "child",
      cwd: "/work",
      timestamp: new Date().toISOString(),
    },
    {
      type: "message",
      id: "1",
      parentId: null,
      message: { role: "assistant", content: [{ type: "text", text }] },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}

describe("subagent transcript cache", () => {
  it("refreshes rendered transcript after a file change", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "transcript-cache-"));
    mkdirSync(join(agentDir, "subagents"));
    const file = join(agentDir, "subagents", "child.session.jsonl");
    writeFileSync(file, sessionJsonl("first"));
    const state = [{ id: "child", agent: "scout", session: file }] as never;

    await showSubagentTranscript(
      { mode: "tui", ui: { custom: vi.fn() } } as never,
      agentDir,
      state,
      "child",
      () => "fallback",
    );
    if (!capturedComponent) throw new Error("component not captured");
    expect(capturedComponent.render(80).join("\n")).toContain("first");

    writeFileSync(file, sessionJsonl("second and longer"));
    expect(capturedComponent.render(80).join("\n")).toContain(
      "second and longer",
    );
  });
});
