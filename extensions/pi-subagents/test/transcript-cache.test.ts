import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

let capturedRead: (() => { title: string; markdown: string }) | undefined;
vi.mock("@hollowheap/pi-ui/pager", () => ({
  showMarkdownPager: (_ctx: unknown, options: { read?: () => never }) => {
    capturedRead = options.read;
    return Promise.resolve();
  },
}));

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
  it("reuses unchanged transcripts and refreshes after a file change", async () => {
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
    if (!capturedRead) throw new Error("read not captured");
    expect(capturedRead().markdown).toContain("first");

    writeFileSync(file, sessionJsonl("second and longer"));
    expect(capturedRead().markdown).toContain("second and longer");
  });
});
