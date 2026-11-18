import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S68: pi-tasks is a workspace extension with core and runtime deps", () => {
  it("is listed in the root suite without a typebox dependency", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(root.pi.extensions).toContain("./extensions/pi-tasks/index.ts");
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(pkg.dependencies["@hollowheap/runtime"]).toBe("^0.3.0");
    expect(pkg.dependencies.typebox).toBeUndefined();
  });

  it("S68 C02: keeps the workspace and lockfile entries consistent", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const lock = JSON.parse(
      readFileSync(`${repoRoot}package-lock.json`, "utf8"),
    );
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(root.workspaces).toContain("extensions/*");
    expect(lock.packages["extensions/pi-tasks"]).toMatchObject({
      name: "@hollowheap/pi-tasks",
      version: pkg.version,
    });
    expect(pkg.pi.extensions).toContain("./index.ts");
  });

  it("S68 C03: registers a direct task tool without codemode or a bash override", () => {
    const source = readFileSync(`${pkgRoot}src/index.ts`, "utf8");
    expect(source).toContain("createTaskTool");
    expect(source).not.toContain('exposure: "codemode"');
    expect(source).not.toContain('registerCommand("bash"');
  });

  it("S68 C04: documents ACP inactivity alongside the PI_ACP guard", () => {
    const source = readFileSync(`${pkgRoot}src/index.ts`, "utf8");
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(source).toContain("if (process.env.PI_ACP) return;");
    expect(readme).toContain("ACP inactivity");
    expect(readme).toContain("PI_ACP");
    expect(readme).toContain("acp_bash");
  });
});
