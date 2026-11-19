import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { effectiveCwd, setCwd } from "@hollowheap/core/state";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";
import { createAcpTools } from "../../../packages/acp/src/extension/tools.js";
import extension from "../src/index.js";

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

describe("/cd and search filtering without a guard dependency", () => {
  it("registers /cd and filters only denied search hits", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    expect(
      pi.registerTool.mock.calls.map(([tool]) => [tool.name, tool.exposure]),
    ).toEqual([
      ["batch", "codemode"],
      ["compact_context", "codemode"],
    ]);
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

describe("/cd boundary, bad targets and acp_fd filtering", () => {
  function cdCommand() {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    extension(pi as never);
    return pi.registerCommand.mock.calls.find(
      ([name]) => name === "cd",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
  }

  it("/cd with no argument resets the effective cwd to the root", async () => {
    const cd = cdCommand();
    const { ctx } = project([]);
    const owner = ctx.sessionManager;
    setCwd(owner, join(ctx.cwd, "sub"));
    expect(effectiveCwd(ctx.cwd, owner)).toBe(join(ctx.cwd, "sub"));

    await cd.handler("", ctx);
    expect(effectiveCwd(ctx.cwd, owner)).toBe(ctx.cwd);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(ctx.cwd),
    );
  });

  it("/cd rejects non-directories and paths outside the root", async () => {
    const cd = cdCommand();
    const { ctx, dir } = project([]);
    writeFileSync(join(dir, "file.txt"), "x");
    await cd.handler("file.txt", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not a directory"),
      "error",
    );

    const outside = mkdtempSync(join(tmpdir(), "draw-s14-outside-"));
    await cd.handler(outside, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("outside project root"),
      "error",
    );
  });

  it("acp_fd keeps only allowed files and terminates its glob flags", async () => {
    const { ctx, dir } = project(["deny search secret.txt"]);
    writeFileSync(join(dir, "secret.txt"), "s");
    writeFileSync(join(dir, "keep.txt"), "k");
    const deps = {
      getCaps: () => ({}),
      connected: () => false,
      callSocket: vi.fn(async () => ({})),
    };
    runBinaryMock.mockClear();
    runBinaryMock.mockResolvedValueOnce("secret.txt\nkeep.txt\n");
    const [fd] = createAcpTools(deps).filter((tool) => tool.name === "acp_fd");
    const text = await run(
      fd as { execute: (...args: never[]) => Promise<unknown> },
      { pattern: "*.txt" },
      ctx,
    );
    expect(text).toContain("keep.txt");
    expect(text).not.toContain("secret.txt");
    const args = runBinaryMock.mock.calls[0][1] as string[];
    expect(args).toContain("--glob");
    expect(args[args.length - 2]).toBe("--");
  });
});
