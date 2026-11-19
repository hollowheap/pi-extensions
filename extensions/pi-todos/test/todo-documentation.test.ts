import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("pi-todos README documents branch-local state and commands", () => {
  it("documents the custom entry, codemode tool, and /todos", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("hollowheap.todos");
    expect(readme).toContain("/todos");
    expect(readme).toContain("codemode");
  });

  it("keeps the package and root workspace manifests consistent", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(root.pi.extensions).toContain("./extensions/pi-todos/index.ts");
    expect(pkg.name).toBe("@hollowheap/pi-todos");
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(pkg.dependencies.typebox).toBeUndefined();
    expect(pkg.peerDependencies.typebox).toBe("*");
  });

  it("documents branch-local state and compaction re-append", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("branch-local");
    expect(readme).toContain("compaction");
    expect(readme).toContain("custom session entry");
  });

  it("documents the tool action set implemented by the todo tool", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    const source = readFileSync(`${pkgRoot}src/index.ts`, "utf8");
    for (const action of [
      "create",
      "complete",
      "delete",
      "edit",
      "priority",
      "list",
    ]) {
      expect(readme).toContain(`\`${action}\``);
      expect(source).toContain(`Type.Literal("${action}")`);
    }
    expect(source).toContain('name: "todo"');
    expect(source).toContain('exposure: "codemode"');
  });
});
