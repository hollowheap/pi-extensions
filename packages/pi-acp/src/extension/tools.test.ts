import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setMode } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import type { ClientCaps } from "./client.js";
import {
  type ToolDeps,
  applyEdits,
  createAcpTools,
  hasConflictMarkers,
} from "./tools.js";

const runBinaryMock = vi.hoisted(() =>
  vi.fn(async (_command: string, _args: string[]) => ""),
);

vi.mock("@hollowheap/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hollowheap/core")>();
  return { ...actual, runBinary: runBinaryMock };
});

function project(rules: string[]): {
  dir: string;
  ctx: Record<string, unknown>;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-acp-tools-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
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

function inMode(
  ctx: Record<string, unknown>,
  mode: string,
): Record<string, unknown> {
  setMode(ctx.sessionManager, mode);
  return ctx;
}

function scriptedDeps(
  caps: ClientCaps,
  answer: (method: string, params: unknown) => unknown,
  connected = true,
): { deps: ToolDeps; calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = [];
  const deps: ToolDeps = {
    getCaps: () => caps,
    connected: () => connected,
    callSocket: async (method, params) => {
      calls.push({ method, params });
      return answer(method, params);
    },
  };
  return { deps, calls };
}

const ALLOW = (_method: string, _params: unknown) => ({
  decision: "allow_once",
});
const REJECT = (_method: string, _params: unknown) => ({
  decision: "reject_once",
});

type Executable = {
  execute: (...args: never[]) => Promise<unknown>;
};

async function run(
  tool: Executable,
  toolCallId: string,
  params: unknown,
  ctx: unknown,
): Promise<string> {
  const result = (await tool.execute(
    toolCallId as never,
    params as never,
    undefined as never,
    (() => {}) as never,
    ctx as never,
  )) as { content: { text: string }[] };
  return result.content.map((block) => block.text).join("");
}

describe("content helpers", () => {
  it("detects conflict markers at line starts", () => {
    expect(hasConflictMarkers("a\n<<<<<<< ours\nb")).toBe(true);
    expect(hasConflictMarkers("=======\n")).toBe(true);
    expect(hasConflictMarkers("x >>>>>>> y")).toBe(false);
    expect(hasConflictMarkers("clean\ncontent")).toBe(false);
  });

  it("applies unique non-overlapping edits", () => {
    expect(applyEdits("aaa bbb", [{ oldText: "aaa", newText: "ccc" }])).toBe(
      "ccc bbb",
    );
    expect(
      applyEdits("aaa bbb", [
        { oldText: "aaa", newText: "x" },
        { oldText: "bbb", newText: "y" },
      ]),
    ).toBe("x y");
  });

  it("refuses missing, ambiguous, and overlapping edits", () => {
    expect(() => applyEdits("aaa", [{ oldText: "zzz", newText: "y" }])).toThrow(
      "not found",
    );
    expect(() =>
      applyEdits("aaa aaa", [{ oldText: "aaa", newText: "y" }]),
    ).toThrow("not unique");
    expect(() =>
      applyEdits("abcdef", [
        { oldText: "abc", newText: "x" },
        { oldText: "bcd", newText: "y" },
      ]),
    ).toThrow("overlap");
  });
});

describe("acp_read", () => {
  it("auto-runs allowed reads without touching the socket", async () => {
    const { dir, ctx } = project(["allow read *"]);
    writeFileSync(join(dir, "a.txt"), "hello");
    const { deps, calls } = scriptedDeps({}, ALLOW);
    const [read] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_read",
    );
    expect(await run(read, "1", { path: "a.txt" }, ctx)).toBe("hello");
    expect(calls).toEqual([]);
  });

  it("reads through the client when declared", async () => {
    const { ctx } = project(["allow read *"]);
    const { deps, calls } = scriptedDeps(
      { fs: { readTextFile: true } },
      (method) =>
        method === "fs-read"
          ? { content: "buffer" }
          : { decision: "allow_once" },
    );
    const [read] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_read",
    );
    expect(await run(read, "1", { path: "a.txt" }, ctx)).toBe("buffer");
    expect(calls.map((call) => call.method)).toEqual(["fs-read"]);
  });

  it("allows reads without rules and blocks on deny without reaching the client", async () => {
    const { dir, ctx } = project([]);
    writeFileSync(join(dir, "a.txt"), "hello");
    const { deps, calls } = scriptedDeps({}, ALLOW);
    const [read] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_read",
    );
    await run(read, "1", { path: "a.txt" }, ctx);
    expect(calls).toEqual([]);
    const denied = project(["deny read *"]);
    const { deps: denyDeps, calls: denyCalls } = scriptedDeps({}, ALLOW);
    const [denyRead] = createAcpTools(denyDeps).filter(
      (tool) => tool.name === "acp_read",
    );
    await expect(
      run(denyRead, "1", { path: "a.txt" }, denied.ctx),
    ).rejects.toThrow("denied");
    expect(denyCalls).toEqual([]);
  });
});

describe("acp_write", () => {
  it("refuses conflict markers before anything else", async () => {
    const { ctx } = project(["allow edit *"]);
    const { deps, calls } = scriptedDeps({}, ALLOW);
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await expect(
      run(write, "1", { path: "n.txt", content: "a\n<<<<<<< x\n" }, ctx),
    ).rejects.toThrow("conflict markers");
    expect(calls).toEqual([]);
  });

  it("refuses existing paths", async () => {
    const { dir, ctx } = project(["allow edit *"]);
    writeFileSync(join(dir, "old.txt"), "x");
    const { deps } = scriptedDeps({}, ALLOW);
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await expect(
      run(write, "1", { path: "old.txt", content: "new" }, ctx),
    ).rejects.toThrow("already exists");
  });

  it("treats a successful client read as existing", async () => {
    const { ctx } = project(["allow edit *"]);
    const { deps } = scriptedDeps({ fs: { readTextFile: true } }, (method) =>
      method === "fs-read" ? { content: "remote" } : {},
    );
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await expect(
      run(write, "1", { path: "ghost.txt", content: "new" }, ctx),
    ).rejects.toThrow("already exists");
  });

  it("creates through the client when declared", async () => {
    const { ctx } = project(["allow edit *"]);
    const written: { method: string; params: unknown }[] = [];
    const { deps } = scriptedDeps(
      { fs: { readTextFile: true, writeTextFile: true } },
      (method, params) => {
        written.push({ method, params });
        if (method === "fs-read") throw new Error("not found");
        return {};
      },
    );
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    expect(
      await run(write, "1", { path: "n.txt", content: "new" }, ctx),
    ).toContain("n.txt");
    expect(written.map((call) => call.method)).toEqual(["fs-read", "fs-write"]);
  });
});

describe("acp_edit", () => {
  it("refuses when the editor buffer differs from disk", async () => {
    const { dir, ctx } = project(["allow edit *"]);
    writeFileSync(join(dir, "a.txt"), "disk");
    const { deps } = scriptedDeps({ fs: { readTextFile: true } }, (method) =>
      method === "fs-read" ? { content: "buffer" } : { decision: "allow_once" },
    );
    const [edit] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_edit",
    );
    await expect(
      run(
        edit,
        "1",
        { path: "a.txt", edits: [{ oldText: "disk", newText: "new" }] },
        ctx,
      ),
    ).rejects.toThrow("differs from disk");
  });

  it("edits locally when the client has no fs", async () => {
    const { dir, ctx } = project(["allow edit *"]);
    writeFileSync(join(dir, "a.txt"), "disk");
    const { deps, calls } = scriptedDeps({}, ALLOW);
    const [edit] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_edit",
    );
    await run(
      edit,
      "1",
      { path: "a.txt", edits: [{ oldText: "disk", newText: "new" }] },
      ctx,
    );
    expect(calls).toEqual([]);
  });
});

describe("acp_bash", () => {
  it("runs allowlisted commands and asks for others in edit", async () => {
    const allowed = project(["allow shell echo hi"]);
    inMode(allowed.ctx, "edit");
    const { deps, calls } = scriptedDeps({}, REJECT);
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    expect(await run(bash, "1", { command: "echo hi" }, allowed.ctx)).toContain(
      "hi",
    );

    const denied = project([]);
    inMode(denied.ctx, "edit");
    const { deps: deniedDeps, calls: deniedCalls } = scriptedDeps({}, REJECT);
    const [deniedBash] = createAcpTools(deniedDeps).filter(
      (tool) => tool.name === "acp_bash",
    );
    await expect(
      run(deniedBash, "1", { command: "rm -rf /" }, denied.ctx),
    ).rejects.toThrow("not approved");
    expect(calls).toEqual([]);
    expect(deniedCalls.map((call) => call.method)).toEqual(["permission"]);
  });

  it("asks the client for commands without an allow rule", async () => {
    const { ctx } = project([]);
    const { deps, calls } = scriptedDeps({}, REJECT);
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    await expect(run(bash, "1", { command: "rm -rf /" }, ctx)).rejects.toThrow(
      "not approved",
    );
    expect(calls.map((call) => call.method)).toEqual(["permission"]);
  });

  it("falls back to local rules without a client", async () => {
    const allowed = project(["allow shell echo hi"]);
    inMode(allowed.ctx, "edit");
    const { deps, calls } = scriptedDeps({}, ALLOW, false);
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    expect(await run(bash, "1", { command: "echo hi" }, allowed.ctx)).toContain(
      "hi",
    );
    expect(calls).toEqual([]);

    const denied = project([]);
    const { deps: noClientDeps, calls: noClientCalls } = scriptedDeps(
      {},
      ALLOW,
      false,
    );
    const [noClientBash] = createAcpTools(noClientDeps).filter(
      (tool) => tool.name === "acp_bash",
    );
    await expect(
      run(noClientBash, "1", { command: "rm -rf /" }, denied.ctx),
    ).rejects.toThrow("denied");
    expect(noClientCalls).toEqual([]);
  });

  it("runs client terminals to completion", async () => {
    const { ctx } = project([]);
    const outputs = [
      { output: "par", exitCode: undefined },
      { output: "done", exitCode: 0 },
    ];
    const { deps, calls } = scriptedDeps({ terminal: true }, (method) => {
      if (method === "permission") return { decision: "allow_once" };
      if (method === "terminal-create") return { terminalId: "t1" };
      if (method === "terminal-output")
        return outputs.shift() ?? { output: "", exitCode: 0 };
      return {};
    });
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    expect(await run(bash, "1", { command: "echo hi" }, ctx)).toBe("done");
    expect(calls.map((call) => call.method)).toEqual([
      "permission",
      "terminal-create",
      "terminal-output",
      "terminal-output",
      "terminal-release",
    ]);
  });

  it("runs locally without a terminal", async () => {
    const { ctx } = project([]);
    const { deps, calls } = scriptedDeps({}, ALLOW);
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    expect(await run(bash, "1", { command: "echo hi" }, ctx)).toContain("hi");
    expect(calls.map((call) => call.method)).toEqual(["permission"]);
  });
});

describe("plan write limits", () => {
  it("denies writes outside plan paths in plan mode", async () => {
    const { ctx } = project(["allow edit *"]);
    inMode(ctx, "plan");
    const { deps, calls } = scriptedDeps({}, ALLOW);
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await expect(
      run(write, "1", { path: "src/x.ts", content: "new" }, ctx),
    ).rejects.toThrow("denied");
    expect(calls).toEqual([]);
  });
});

describe("tool protocol details", () => {
  it("creates missing parent directories on write", async () => {
    const { dir, ctx } = project(["allow edit *"]);
    const { deps } = scriptedDeps({}, ALLOW);
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await run(
      write,
      "1",
      { path: "nested/dir/file.txt", content: "hello" },
      ctx,
    );
    expect(readFileSync(join(dir, "nested", "dir", "file.txt"), "utf8")).toBe(
      "hello",
    );
  });

  it("reports a missing file on edit", async () => {
    const { ctx } = project(["allow edit *"]);
    const { deps } = scriptedDeps({}, ALLOW);
    const [edit] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_edit",
    );
    await expect(
      run(edit, "1", { path: "missing.txt", edits: [] }, ctx),
    ).rejects.toThrow("file not found");
  });

  it("terminates fd and rg options with --", async () => {
    const { ctx } = project(["allow search *"]);
    runBinaryMock.mockClear();
    const deps = scriptedDeps({}, ALLOW).deps;
    const tools = createAcpTools(deps);
    const [fd] = tools.filter((tool) => tool.name === "acp_fd");
    const [rg] = tools.filter((tool) => tool.name === "acp_rg");
    await run(fd, "1", { pattern: "*.ts" }, ctx);
    await run(rg, "1", { pattern: "hit" }, ctx);
    const fdArgs = runBinaryMock.mock.calls[0][1] as string[];
    const rgArgs = runBinaryMock.mock.calls[1][1] as string[];
    expect(fdArgs).toEqual(["--glob", "*.ts", "--", "."]);
    expect(rgArgs).toContain("--regexp");
    expect(rgArgs[rgArgs.length - 2]).toBe("--");
  });

  it("refuses to list a file with eza", async () => {
    const { dir, ctx } = project(["allow search *"]);
    writeFileSync(join(dir, "a.txt"), "x");
    const { deps } = scriptedDeps({}, ALLOW);
    const [eza] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_eza",
    );
    await expect(run(eza, "1", { path: "a.txt" }, ctx)).rejects.toThrow(
      "not a directory",
    );
  });

  it("stops polling a terminal after the wall-clock deadline", async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = project([]);
      const { deps } = scriptedDeps({ terminal: true }, (method) => {
        if (method === "permission") return { decision: "allow_once" };
        if (method === "terminal-create") return { terminalId: "t1" };
        if (method === "terminal-output") return { output: "tick" };
        return {};
      });
      const [bash] = createAcpTools(deps).filter(
        (tool) => tool.name === "acp_bash",
      );
      const pending = run(bash, "1", { command: "sleep 100" }, ctx);
      const assertion = expect(pending).rejects.toThrow("command timed out");
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
