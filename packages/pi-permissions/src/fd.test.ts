import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type ExecDeps, runBinary } from "./exec.js";
import { createFdTool } from "./fd.js";

function project(rules: string[]): {
  dir: string;
  ctx: { cwd: string; ui: { notify: ReturnType<typeof vi.fn> } };
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-fd-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "permissions.json"),
    JSON.stringify({ rules }),
  );
  return { dir, ctx: { cwd: dir, ui: { notify: vi.fn() } } };
}

function fakeDeps(stdout: string, mtimes: Record<string, number>): ExecDeps {
  return {
    run: async () => stdout,
    statMtimeMs: (path) => mtimes[path],
  };
}

function textOf(result: { content: unknown }): string {
  const [first] = result.content as [{ type: string; text: string }];
  return first.text;
}

describe("fd tool", () => {
  it("returns matches newest first as root-relative paths", async () => {
    const { dir, ctx } = project(["allow read *"]);
    const tool = createFdTool(
      fakeDeps("a.ts\nb.ts\n", {
        [join(dir, "a.ts")]: 100,
        [join(dir, "b.ts")]: 200,
      }),
    );
    const result = await tool.execute(
      "call-1",
      { pattern: "*.ts" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("b.ts\na.ts");
  });

  it("limits output to max_results", async () => {
    const { dir, ctx } = project(["allow read *"]);
    const tool = createFdTool(
      fakeDeps("a.ts\nb.ts\nc.ts\n", {
        [join(dir, "a.ts")]: 1,
        [join(dir, "b.ts")]: 2,
        [join(dir, "c.ts")]: 3,
      }),
    );
    const result = await tool.execute(
      "call-1",
      { pattern: "*.ts", max_results: 2 },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("c.ts\nb.ts");
  });

  it("drops denied paths", async () => {
    const { dir, ctx } = project(["allow read *", "deny read secret/*"]);
    const tool = createFdTool(
      fakeDeps("ok.ts\nsecret/x.ts\n", {
        [join(dir, "ok.ts")]: 1,
        [join(dir, "secret/x.ts")]: 2,
      }),
    );
    const result = await tool.execute(
      "call-1",
      { pattern: "*.ts" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("ok.ts");
  });

  it("reports all denied as no files found", async () => {
    const { dir, ctx } = project(["deny read *"]);
    const tool = createFdTool(fakeDeps("a.ts\n", { [join(dir, "a.ts")]: 1 }));
    const result = await tool.execute(
      "call-1",
      { pattern: "*.ts" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(result)).toBe("No files found.");
  });

  it("returns a clear error when fd is missing", async () => {
    const { ctx } = project(["allow read *"]);
    const tool = createFdTool({
      run: async () => {
        throw new Error("fd is not installed (binary not found in PATH)");
      },
      statMtimeMs: () => 1,
    });
    await expect(
      tool.execute(
        "call-1",
        { pattern: "*.ts" },
        undefined,
        () => {},
        ctx as never,
      ),
    ).rejects.toThrow("not installed");
  });

  it("finds real files with the fd binary", async () => {
    const { dir, ctx } = project(["allow read *"]);
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "a.ts"), "const a = 1;\n");
    writeFileSync(join(dir, "sub", "b.md"), "# docs\n");
    const tool = createFdTool();
    const all = await tool.execute(
      "call-1",
      { pattern: "*.ts" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(all)).toBe("sub/a.ts");
    const scoped = await tool.execute(
      "call-2",
      { pattern: "*.md", path: "sub" },
      undefined,
      () => {},
      ctx as never,
    );
    expect(textOf(scoped)).toBe("sub/b.md");
  });

  it("fails clearly for a missing search path", async () => {
    const { ctx } = project(["allow read *"]);
    const tool = createFdTool();
    await expect(
      tool.execute(
        "call-1",
        { pattern: "*.ts", path: "nope" },
        undefined,
        () => {},
        ctx as never,
      ),
    ).rejects.toThrow("does not exist");
  });
});

describe("runBinary", () => {
  it("reports a clear error when the binary is missing", async () => {
    await expect(
      runBinary("pi-permissions-missing-binary", [], tmpdir(), undefined),
    ).rejects.toThrow("is not installed");
  });
});
