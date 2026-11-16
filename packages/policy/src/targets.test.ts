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
    expect(TOOL_TAGS.codemode).toBe("read");
    expect(TOOL_TAGS.question).toBe("read");
    expect(TOOL_TAGS.todo).toBe("read");
    expect(TOOL_TAGS.todos).toBe("read");
    expect(TOOL_TAGS.memory_search).toBe("read");
    expect(TOOL_TAGS.memory_remember).toBe("read");
  });

  it("extracts non-path targets", () => {
    expect(readToolTarget("web_fetch", { url: "https://example.com" })).toBe(
      "https://example.com",
    );
    expect(readToolTarget("web_search", { query: "lil bro" })).toBe("lil bro");
    expect(readToolTarget("decide", { input: "x" })).toBe("decide");
    expect(readToolTarget("codemode", { code: "console.log(1)" })).toBe(
      "codemode",
    );
    expect(readToolTarget("question", { prompt: "hi" })).toBe("question");
    expect(readToolTarget("todo", { action: "list" })).toBe("todo");
    expect(readToolTarget("todos", { action: "list" })).toBe("todo");
    expect(readToolTarget("memory_search", { query: "commits" })).toBe(
      "memory",
    );
    expect(readToolTarget("memory_remember", { text: "fact" })).toBe("memory");
    expect(readToolTarget("read", { path: "src/x.ts" })).toBe("src/x.ts");
  });

  it("extracts shell and subagent targets", () => {
    expect(readCommandArg({ command: "echo hi" })).toBe("echo hi");
    expect(readCommandArg({ agent: "scout" })).toBe("subagent scout");
    expect(readCommandArg({ id: "abc" })).toBe("subagent @abc");
  });

  it("passes through task inspection actions", () => {
    expect(isPassthroughTaskCall("task", { action: "list" })).toBe(true);
    expect(isPassthroughTaskCall("subagent", { action: "define" })).toBe(true);
    expect(isPassthroughTaskCall("subagent", { action: "delete" })).toBe(true);
    expect(isPassthroughTaskCall("subagent", { action: "cancel" })).toBe(true);
    expect(isPassthroughTaskCall("task", { action: "start" })).toBe(false);
    expect(isPassthroughTaskCall("bash", { action: "list" })).toBe(false);
  });
});
