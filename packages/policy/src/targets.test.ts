import { describe, expect, it } from "vitest";
import {
  TOOL_TAGS,
  isPassthroughTaskCall,
  readCommandArg,
  readToolTarget,
} from "./targets.js";

describe("policy targets", () => {
  it("maps built-in and suite tools to categories", () => {
    expect(TOOL_TAGS.read).toBe("read");
    expect(TOOL_TAGS.edit).toBe("edit");
    expect(TOOL_TAGS.bash).toBe("shell");
    expect(TOOL_TAGS.web_fetch).toBe("external");
    expect(TOOL_TAGS.decide).toBe("external");
    expect(TOOL_TAGS.lang).toBe("read");
  });

  it("extracts non-path targets", () => {
    expect(readToolTarget("web_fetch", { url: "https://example.com" })).toBe(
      "https://example.com",
    );
    expect(readToolTarget("web_search", { query: "lil bro" })).toBe("lil bro");
    expect(readToolTarget("decide", { input: "x" })).toBe("decide");
    expect(readToolTarget("read", { path: "src/x.ts" })).toBe("src/x.ts");
  });

  it("extracts shell and subagent targets", () => {
    expect(readCommandArg({ command: "echo hi" })).toBe("echo hi");
    expect(readCommandArg({ agent: "scout" })).toBe("subagent scout");
    expect(readCommandArg({ id: "abc" })).toBe("subagent @abc");
  });

  it("passes through task inspection actions", () => {
    expect(isPassthroughTaskCall("task", { action: "list" })).toBe(true);
    expect(isPassthroughTaskCall("subagent", { action: "cancel" })).toBe(true);
    expect(isPassthroughTaskCall("task", { action: "start" })).toBe(false);
    expect(isPassthroughTaskCall("bash", { action: "list" })).toBe(false);
  });
});
