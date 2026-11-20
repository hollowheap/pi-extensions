import { describe, expect, it } from "vitest";
import {
  applyTokenCompletion,
  prefixCompletions,
} from "../src/autocomplete.js";

describe("prefixCompletions", () => {
  it("matches string candidates case-insensitively while preserving order", () => {
    expect(
      prefixCompletions("SE", new Set(["logs", "settings", "Set", "config"])),
    ).toEqual([
      { value: "settings", label: "settings" },
      { value: "Set", label: "Set" },
    ]);
  });

  it("maps typed candidates in a single pass", () => {
    const items = [
      { id: "task-2", status: "running" },
      { id: "other", status: "completed" },
      { id: "task-1", status: "completed" },
    ];
    let mapperCalls = 0;

    const result = prefixCompletions("TASK", items, (item) => {
      mapperCalls += 1;
      return {
        value: item.id,
        label: item.id,
        description: item.status,
      };
    });

    expect(mapperCalls).toBe(3);
    expect(result).toEqual([
      { value: "task-2", label: "task-2", description: "running" },
      { value: "task-1", label: "task-1", description: "completed" },
    ]);
  });
});

describe("applyTokenCompletion", () => {
  it("replaces the active prefix and appends a trailing space when needed", () => {
    expect(applyTokenCompletion(["/task lo"], 0, 8, "logs", "lo")).toEqual({
      lines: ["/task logs "],
      cursorLine: 0,
      cursorCol: 11,
    });
  });

  it("does not duplicate whitespace when a space already follows the cursor", () => {
    expect(
      applyTokenCompletion(["/task lo task-1"], 0, 8, "logs", "lo"),
    ).toEqual({
      lines: ["/task logs task-1"],
      cursorLine: 0,
      cursorCol: 10,
    });
  });
});
