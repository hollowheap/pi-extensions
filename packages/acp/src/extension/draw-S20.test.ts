import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";
import { type ToolDeps, createAcpTools } from "./tools.js";

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

function project() {
  const dir = mkdtempSync(join(tmpdir(), "draw-s20-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  const agent = join(dir, "agent");
  mkdirSync(agent, { recursive: true });
  state.agentDir = agent;
  writeFileSync(
    join(dir, ".pi", "permissions.json"),
    JSON.stringify({ rules: ["allow edit *", "allow search *"] }),
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

function scriptedDeps(
  caps: Record<string, unknown>,
  answer: (method: string) => unknown,
): ToolDeps {
  return {
    getCaps: () => caps,
    connected: () => true,
    callSocket: async (method: string) => answer(method),
  };
}

async function run(
  tool: { execute: (...args: never[]) => Promise<unknown> },
  params: unknown,
  ctx: unknown,
): Promise<string> {
  const result = (await tool.execute(
    "1" as never,
    params as never,
    undefined as never,
    (() => {}) as never,
    ctx as never,
  )) as { content: { text: string }[] };
  return result.content.map((block) => block.text).join("");
}

describe("S20: ACP tool protocol details", () => {
  it("creates write parents, rejects missing and drifted edits, terminates flags and requires a directory", async () => {
    const { ctx, dir } = project();
    const local: ToolDeps = {
      getCaps: () => ({}),
      connected: () => false,
      callSocket: vi.fn(async () => ({})),
    };
    const tools = createAcpTools(local);
    const tool = (name: string) => {
      const found = tools.find((entry) => entry.name === name);
      expect(found).toBeDefined();
      return found as { execute: (...args: never[]) => Promise<unknown> };
    };

    await run(
      tool("acp_write"),
      {
        path: "nested/dir/file.txt",
        content: "hello",
      },
      ctx,
    );
    expect(readFileSync(join(dir, "nested/dir/file.txt"), "utf8")).toBe(
      "hello",
    );

    await expect(
      run(tool("acp_edit"), { path: "missing.txt", edits: [] }, ctx),
    ).rejects.toThrow("file not found");

    writeFileSync(join(dir, "drift.txt"), "disk");
    const driftDeps = scriptedDeps({ fs: { readTextFile: true } }, (method) =>
      method === "fs-read" ? { content: "buffer" } : { decision: "allow_once" },
    );
    const [driftEdit] = createAcpTools(driftDeps).filter(
      (entry) => entry.name === "acp_edit",
    );
    await expect(
      run(
        driftEdit as { execute: (...args: never[]) => Promise<unknown> },
        { path: "drift.txt", edits: [{ oldText: "disk", newText: "new" }] },
        ctx,
      ),
    ).rejects.toThrow("differs from disk");

    runBinaryMock.mockClear();
    await run(tool("acp_fd"), { pattern: "*.ts" }, ctx);
    await run(tool("acp_rg"), { pattern: "hit", glob: "*.ts" }, ctx);
    const fdArgs = runBinaryMock.mock.calls[0][1] as string[];
    const rgArgs = runBinaryMock.mock.calls[1][1] as string[];
    expect(fdArgs).toEqual(["--glob", "*.ts", "--", "."]);
    expect(rgArgs).toContain("--regexp");
    expect(rgArgs[rgArgs.length - 2]).toBe("--");

    writeFileSync(join(dir, "a.txt"), "x");
    await expect(run(tool("acp_eza"), { path: "a.txt" }, ctx)).rejects.toThrow(
      "not a directory",
    );
  });
});
