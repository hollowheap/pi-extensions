import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";
import { createAcpTools } from "../../../packages/acp/src/extension/tools.js";
import extension from "./index.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));
const runBinaryMock = vi.hoisted(() =>
  vi.fn(async (_command: string, _args: string[]) => ""),
);

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
vi.mock("@hollowheap/runtime/exec", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hollowheap/runtime/exec")>();
  return { ...actual, runBinary: runBinaryMock };
});

function project(rules: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "draw-s14-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  const agent = join(dir, "agent");
  mkdirSync(agent, { recursive: true });
  state.agentDir = agent;
  writeFileSync(
    join(dir, ".pi", "permissions.json"),
    JSON.stringify({ rules }),
  );
  return {
    dir,
    ctx: {
      cwd: dir,
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(), setStatus: vi.fn() },
    },
  };
}

async function run(
  tool: { execute: (...args: never[]) => Promise<unknown> },
  params: unknown,
  ctx: unknown,
) {
  const result = (await tool.execute(
    "1" as never,
    params as never,
    undefined as never,
    (() => {}) as never,
    ctx as never,
  )) as { content: { text: string }[] };
  return result.content.map((block) => block.text).join("");
}

describe("S14: /cd and search filtering without a guard dependency", () => {
  it("registers /cd and filters only denied search hits", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual(["cd"]);

    const { ctx } = project(["deny search secret.txt", "ask search keep.txt"]);
    const deps = {
      getCaps: () => ({}),
      connected: () => false,
      callSocket: vi.fn(async () => ({})),
    };
    runBinaryMock.mockClear();
    runBinaryMock.mockResolvedValueOnce("secret.txt:1:secret\nkeep.txt:2:ok\n");
    const tools = createAcpTools(deps);
    const [rg] = tools.filter((tool) => tool.name === "acp_rg");
    const text = await run(rg, { pattern: "hit" }, ctx);
    expect(text).toContain("keep.txt:2:ok");
    expect(text).not.toContain("secret.txt");
    const args = runBinaryMock.mock.calls[0][1] as string[];
    expect(args).toContain("--regexp");
    expect(args[args.length - 2]).toBe("--");
    expect(deps.callSocket).not.toHaveBeenCalled();
  });
});
