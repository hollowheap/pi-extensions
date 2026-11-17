import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
import extension from "./index.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function setup(rules: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-guard-draw-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rules);
  const pi = {
    on: vi.fn(
      (_event: string, _fn: (...args: unknown[]) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
  };
  extension(pi as never);
  const handler = pi.on.mock.calls.find(
    ([event]) => event === "tool_call",
  )?.[1] as ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  if (!handler) throw new Error("missing tool_call handler");
  const ctx = {
    cwd: dir,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn(), confirm: vi.fn(async () => false) },
  };
  return {
    call: (toolName: string, input: unknown) =>
      handler(
        { type: "tool_call", toolCallId: "1", toolName, input } as never,
        ctx as never,
      ),
  };
}

describe("S83: web tool tags are built-in and authoritative", () => {
  it("ignores user-configured tag overrides for web_search and web_fetch", async () => {
    const { call } = setup(
      JSON.stringify({
        tools: { web_search: "read", web_fetch: "search" },
        rules: ["deny external *"],
      }),
    );

    await expect(call("web_search", { query: "x" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    await expect(call("web_fetch", { url: "x" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });
});
