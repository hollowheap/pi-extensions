import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ClientCaps } from "./client.js";
import type { Mode } from "./modes.js";
import {
  type ToolDeps,
  applyEdits,
  createAcpTools,
  hasConflictMarkers,
} from "./tools.js";

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
      ui: { notify: vi.fn(), confirm: vi.fn(), setStatus: vi.fn() },
    },
  };
}

function scriptedDeps(
  mode: Mode,
  caps: ClientCaps,
  answer: (method: string, params: unknown) => unknown,
  connected = true,
): { deps: ToolDeps; calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = [];
  const deps: ToolDeps = {
    getMode: () => mode,
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
    const { deps, calls } = scriptedDeps("ask", {}, ALLOW);
    const [read] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_read",
    );
    expect(await run(read, "1", { path: "a.txt" }, ctx)).toBe("hello");
    expect(calls).toEqual([]);
  });

  it("reads through the client when declared", async () => {
    const { ctx } = project(["allow read *"]);
    const { deps, calls } = scriptedDeps(
      "ask",
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

  it("asks without rules and blocks on deny without reaching the client", async () => {
    const { dir, ctx } = project([]);
    writeFileSync(join(dir, "a.txt"), "hello");
    const { deps, calls } = scriptedDeps("ask", {}, ALLOW);
    const [read] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_read",
    );
    await run(read, "1", { path: "a.txt" }, ctx);
    expect(calls.map((call) => call.method)).toEqual(["permission"]);
    const denied = project(["deny read *"]);
    const { deps: denyDeps, calls: denyCalls } = scriptedDeps("ask", {}, ALLOW);
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
    const { deps, calls } = scriptedDeps("edit", {}, ALLOW);
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
    const { deps } = scriptedDeps("edit", {}, ALLOW);
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await expect(
      run(write, "1", { path: "old.txt", content: "new" }, ctx),
    ).rejects.toThrow("already exists");
  });

  it("treats a successful client read as existing", async () => {
    const { ctx } = project(["allow edit *"]);
    const { deps } = scriptedDeps(
      "edit",
      { fs: { readTextFile: true } },
      (method) => (method === "fs-read" ? { content: "remote" } : {}),
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
      "edit",
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
    const { deps } = scriptedDeps(
      "ask",
      { fs: { readTextFile: true } },
      (method) =>
        method === "fs-read"
          ? { content: "buffer" }
          : { decision: "allow_once" },
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
    const { deps, calls } = scriptedDeps("edit", {}, ALLOW);
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
  it("runs allowlisted commands and denies others in edit", async () => {
    const allowed = project(["allow shell echo hi"]);
    const { deps, calls } = scriptedDeps("edit", {}, REJECT);
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    expect(await run(bash, "1", { command: "echo hi" }, allowed.ctx)).toContain(
      "hi",
    );

    const denied = project([]);
    const { deps: deniedDeps, calls: deniedCalls } = scriptedDeps(
      "edit",
      {},
      REJECT,
    );
    const [deniedBash] = createAcpTools(deniedDeps).filter(
      (tool) => tool.name === "acp_bash",
    );
    await expect(
      run(deniedBash, "1", { command: "rm -rf /" }, denied.ctx),
    ).rejects.toThrow("mode denies shell");
    expect(calls).toEqual([]);
    expect(deniedCalls).toEqual([]);
  });

  it("asks the client for commands without an allow rule", async () => {
    const { ctx } = project([]);
    const { deps, calls } = scriptedDeps("ask", {}, REJECT);
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
    const { deps, calls } = scriptedDeps("edit", {}, ALLOW, false);
    const [bash] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_bash",
    );
    expect(await run(bash, "1", { command: "echo hi" }, allowed.ctx)).toContain(
      "hi",
    );
    expect(calls).toEqual([]);

    const denied = project([]);
    const { deps: noClientDeps, calls: noClientCalls } = scriptedDeps(
      "edit",
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
    const { deps, calls } = scriptedDeps(
      "ask",
      { terminal: true },
      (method) => {
        if (method === "permission") return { decision: "allow_once" };
        if (method === "terminal-create") return { terminalId: "t1" };
        if (method === "terminal-output")
          return outputs.shift() ?? { output: "", exitCode: 0 };
        return {};
      },
    );
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
    const { deps, calls } = scriptedDeps("ask", {}, ALLOW);
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
    const { deps, calls } = scriptedDeps("plan", {}, ALLOW);
    const [write] = createAcpTools(deps).filter(
      (tool) => tool.name === "acp_write",
    );
    await expect(
      run(write, "1", { path: "src/x.ts", content: "new" }, ctx),
    ).rejects.toThrow("denied");
    expect(calls).toEqual([]);
  });
});
