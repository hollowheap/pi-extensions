import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S61: pi-todos README documents branch-local state and commands", () => {
  it("documents the custom entry, codemode tool, and /todos", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("hollowheap.todos");
    expect(readme).toContain("/todos");
    expect(readme).toContain("codemode");
  });
});
