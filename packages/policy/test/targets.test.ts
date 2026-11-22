import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE_ENTRY_TYPE, getSessionUsage } from "@hollowheap/core/usage";
import { describe, expect, it, vi } from "vitest";
import {
  classifyToolCall,
  hasAvailableClassifierModel,
} from "../src/classifier.js";
import {
  TOOL_TAGS,
  isPassthroughTaskCall,
  readCommandArg,
  readToolTarget,
} from "../src/targets.js";

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

  it("passes through only inspection actions", () => {
    expect(isPassthroughTaskCall("task", { action: "list" })).toBe(true);
    expect(isPassthroughTaskCall("task", { action: "status" })).toBe(true);
    expect(isPassthroughTaskCall("task", { action: "wait" })).toBe(true);
    expect(isPassthroughTaskCall("subagent", { action: "define" })).toBe(true);
    expect(isPassthroughTaskCall("subagent", { action: "delete" })).toBe(false);
    expect(isPassthroughTaskCall("subagent", { action: "cancel" })).toBe(false);
    expect(isPassthroughTaskCall("task", { action: "cancel" })).toBe(false);
    expect(isPassthroughTaskCall("task", { action: "start" })).toBe(false);
    expect(isPassthroughTaskCall("bash", { action: "list" })).toBe(false);
  });

  it("resolves a classifier id that already includes its provider prefix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-classifier-prefix-"));
    const model = "alias/classifier-v2";
    writeFileSync(join(dir, "decide.json"), JSON.stringify({ model }));
    const getModelsOfType = vi.fn(() => [
      { id: model, provider: "host-provider" },
    ]);
    const getModelOfType = vi.fn((_type: unknown, provider: string) =>
      provider === "host-provider"
        ? { id: model, provider: "host-provider" }
        : undefined,
    );
    const ctx = {
      modelRegistry: { getModelsOfType, getModelOfType, classify: vi.fn() },
    } as never;

    expect(hasAvailableClassifierModel(ctx, dir)).toBe(true);
    expect(getModelOfType).toHaveBeenCalledWith(
      "classifier",
      "host-provider",
      model,
    );
  });

  it("honors decide.json classifier model via getModelOfType and records usage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-classifier-"));
    writeFileSync(
      join(dir, "decide.json"),
      JSON.stringify({ model: "custom/classifier-v1" }),
    );
    const getModelOfType = vi.fn(() => ({
      provider: "custom",
      id: "classifier-v1",
    }));
    const classify = vi.fn().mockResolvedValue({
      stopReason: "stop",
      answers: { answer: { choice: "block" } },
      usage: {
        input: 20,
        output: 4,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 0.002 },
      },
    });
    const sessionManager = {
      getBranch: () => [],
      appendCustomEntry: vi.fn(),
    };
    const appendEntry = vi.fn();
    const emitEvent = vi.fn();

    const verdict = await classifyToolCall(
      {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "read",
        input: { path: "src/index.ts" },
      } as never,
      "read",
      {
        sessionManager,
        modelRegistry: { getModelOfType, classify },
      } as never,
      { agentDir: dir, appendEntry, emitEvent },
    );

    expect(getModelOfType).toHaveBeenCalledWith(
      "classifier",
      "custom",
      "classifier-v1",
    );
    expect(verdict).toEqual({ kind: "block" });
    expect(getSessionUsage(sessionManager)).toEqual(
      expect.objectContaining({
        totalTokens: 24,
        totalCost: 0.002,
      }),
    );
    expect(appendEntry).toHaveBeenCalledWith(
      USAGE_ENTRY_TYPE,
      expect.objectContaining({ totalCost: 0.002 }),
    );
    expect(emitEvent).toHaveBeenCalledWith("usage:refresh", undefined);
  });
});
