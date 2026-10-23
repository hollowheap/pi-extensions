import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setCwd } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import { type ExecDeps, clampMaxResults } from "./exec.js";
import { createRgTool, isFileTarget, parseRgLine } from "./rg.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

function project(rules: string[]): {
  dir: string;
  ctx: {
    cwd: string;
    sessionManager: object;
    isProjectTrusted: () => boolean;
    ui: { notify: ReturnType<typeof vi.fn> };
  };
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-rg-"));
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
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    },
  };
}

function textOf(result: { content: unknown }): string {
  const [first] = result.content as [{ type: string; text: string }];
  return first.text;
}

describe("parseRgLine", () => {
  it("splits path, line, and text", () => {
    expect(parseRgLine("a.ts:2:hello world")).toEqual({
      path: "a.ts",
      line: 2,
      text: "hello world",
    });
  });

  it("tolerates colons in paths", () => {
    expect(parseRgLine("a:b.ts:3:x")).toEqual({
      path: "a:b.ts",
      line: 3,
      text: "x",
    });
  });

  it("rejects malformed lines", () => {
    expect(parseRgLine("garbage")).toBeUndefined();
    expect(parseRgLine("a.ts:notnum:x")).toBeUndefined();
  });
});

describe("isFileTarget", () => {
  it("distinguishes files, directories, and missing paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-istarget-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, "x");
    expect(isFileTarget(file)).toBe(true);
    expect(isFileTarget(dir)).toBe(false);
    expect(isFileTarget(join(dir, "missing"))).toBe(false);
  });
});

describe("rg tool", () => {
  it("finds matching lines as path:line:text", async () => {
    const { ctx } = project(["allow search *"]);
    const deps: ExecDeps = {
      run: async () => "a.ts:2:hello world\nb.ts:1:say hello\n",
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "hello" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("a.ts:2:hello world\nb.ts:1:say hello");
  });

  it("passes the glob filter to the binary", async () => {
    const { ctx } = project(["allow search *"]);
    let seen: string[] = [];
    const deps: ExecDeps = {
      run: async (_command, args) => {
        seen = args;
        return "";
      },
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    await tool.execute(
      "call-1",
      { pattern: "hello", glob: "*.ts" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(seen).toContain("--glob");
    expect(seen).toContain("*.ts");
  });

  it("limits output to max_results", async () => {
    const { ctx } = project(["allow search *"]);
    const deps: ExecDeps = {
      run: async () => "a.ts:1:x\na.ts:2:x\na.ts:3:x\n",
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "x", max_results: 2 },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("a.ts:1:x\na.ts:2:x");
  });

  it("drops matches from denied files", async () => {
    const { ctx } = project(["allow search *", "deny search b.ts"]);
    const deps: ExecDeps = {
      run: async () => "a.ts:1:hit\nb.ts:2:hit\n",
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "hit" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("a.ts:1:hit");
  });

  it("drops matches from symlinks that point outside the root", async () => {
    const { dir, ctx } = project(["allow search *"]);
    const outside = mkdtempSync(join(tmpdir(), "pi-rg-outside-"));
    writeFileSync(join(outside, "evil.ts"), "hit\n");
    symlinkSync(outside, join(dir, "link"));
    const deps: ExecDeps = {
      run: async () => "link/evil.ts:1:hit\n",
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "hit" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("No matches found.");
  });

  it("skips symlinked directories passed as the search path", async () => {
    const { dir, ctx } = project(["allow search *"]);
    const outside = mkdtempSync(join(tmpdir(), "pi-rg-outside-"));
    writeFileSync(join(outside, "evil.ts"), "hit\n");
    symlinkSync(outside, join(dir, "link"));
    const tool = createRgTool();
    const result = await tool.execute(
      "call-1",
      { pattern: "hit", path: "link" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("No matches found.");
  });

  it("returns matches relative to the cd override", async () => {
    const { dir, ctx } = project(["allow search *"]);
    mkdirSync(join(dir, "sub"), { recursive: true });
    setCwd(ctx.sessionManager, join(dir, "sub"));
    const deps: ExecDeps = {
      run: async () => "a.ts:1:hit\n",
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "hit" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("a.ts:1:hit");
  });

  it("searches a file passed as the search path", async () => {
    const { dir, ctx } = project(["allow search *"]);
    writeFileSync(join(dir, "a.ts"), "hello world\n");
    const tool = createRgTool();
    const result = await tool.execute(
      "call-1",
      { pattern: "hello", path: "a.ts" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("a.ts:1:hello world");
  });

  it("cuts each line to 300 characters", async () => {
    const { ctx } = project(["allow search *"]);
    const deps: ExecDeps = {
      run: async () => `a.ts:1:${"x".repeat(500)}\n`,
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "x" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result).length).toBeLessThanOrEqual(300);
  });

  it("keeps matches that only ask", async () => {
    const { ctx } = project(["ask search *"]);
    const deps: ExecDeps = {
      run: async () => "a.ts:1:hit\n",
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    const result = await tool.execute(
      "call-1",
      { pattern: "hit" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("a.ts:1:hit");
  });

  it("passes the pattern via --regexp and terminates the options", async () => {
    const { ctx } = project(["allow search *"]);
    let seen: string[] = [];
    const deps: ExecDeps = {
      run: async (_command, args) => {
        seen = args;
        return "";
      },
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    await tool.execute(
      "call-1",
      { pattern: "-dash" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(seen).toContain("--regexp");
    expect(seen).toContain("-dash");
    expect(seen[seen.length - 2]).toBe("--");
  });

  it("returns a clear error when rg is missing", async () => {
    const { ctx } = project(["allow search *"]);
    const deps: ExecDeps = {
      run: async () => {
        throw new Error("rg is not installed (binary not found in PATH)");
      },
      statMtimeMs: () => 1,
    };
    const tool = createRgTool(deps);
    await expect(
      tool.execute(
        "call-1",
        { pattern: "x" },
        undefined,
        () => {},
        ctx as never,
      ),
    ).rejects.toThrow("not installed");
  });

  it("searches real files with the rg binary", async () => {
    const { dir, ctx } = project(["allow search *"]);
    mkdirSync(join(dir, "notes"), { recursive: true });
    writeFileSync(join(dir, "notes", "a.ts"), "hello world\nfoo\n");
    writeFileSync(join(dir, "notes", "b.md"), "hello markdown\n");
    const tool = createRgTool();
    const filtered = await tool.execute(
      "call-1",
      { pattern: "hello \\w+", glob: "*.ts", path: "notes" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(filtered)).toBe("notes/a.ts:1:hello world");
    const everything = await tool.execute(
      "call-2",
      { pattern: "hello" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(everything).split("\n").sort()).toEqual(
      ["notes/a.ts:1:hello world", "notes/b.md:1:hello markdown"].sort(),
    );
  });

  it("reports no matches instead of failing", async () => {
    const { ctx } = project(["allow search *"]);
    const tool = createRgTool();
    const result = await tool.execute(
      "call-1",
      { pattern: "zzz-no-match" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("No matches found.");
  });
});

describe("clampMaxResults", () => {
  it("defaults and clamps to 1..500", () => {
    expect(clampMaxResults(undefined)).toBe(100);
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(999)).toBe(500);
    expect(clampMaxResults(2.7)).toBe(2);
    expect(clampMaxResults(Number.NaN)).toBe(100);
  });
});
