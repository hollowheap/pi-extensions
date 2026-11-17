import { describe, expect, it } from "vitest";
import { formatSubagentLog } from "./index.js";

describe("formatSubagentLog", () => {
  it("returns raw log when raw is true", () => {
    const log = "hello\nworld";
    expect(formatSubagentLog(log, true)).toBe("hello\nworld");
  });
  it("returns (no output) for empty log", () => {
    expect(formatSubagentLog("", false)).toBe("(no output)");
    expect(formatSubagentLog("   ", false)).toBe("(no output)");
  });
  it("extracts assistant text from JSONL", () => {
    const log = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    expect(formatSubagentLog(log, false)).toBe("Hello world");
  });
  it("extracts tool calls as summary", () => {
    const log = JSON.stringify({
      type: "tool_call",
      toolName: "read",
      args: { path: "/foo/bar.ts" },
    });
    expect(formatSubagentLog(log, false)).toBe("> read (path=/foo/bar.ts)");
  });
  it("falls back to raw text when no JSON parses", () => {
    const log = "plain text output";
    expect(formatSubagentLog(log, false)).toBe("plain text output");
  });
  it("handles multiple entries", () => {
    const log = [
      JSON.stringify({
        type: "tool_call",
        toolName: "bash",
        args: { command: "ls" },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      }),
    ].join("\n");
    expect(formatSubagentLog(log, false)).toContain("Done");
    expect(formatSubagentLog(log, false)).toContain("> bash");
  });
});
