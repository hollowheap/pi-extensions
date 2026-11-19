import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("pi-language-tools is a workspace extension exposing lang", () => {
  it("is listed in the root suite, depends on core, and declares the lang tool", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    const source = readFileSync(`${pkgRoot}src/tool.ts`, "utf8");
    expect(root.pi.extensions).toContain(
      "./extensions/pi-language-tools/index.ts",
    );
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(pkg.dependencies.typebox).toBeUndefined();
    expect(source).toContain('name: "lang"');
  });

  it("exposes lang only through codemode and activates it on session start", () => {
    const toolSource = readFileSync(`${pkgRoot}src/tool.ts`, "utf8");
    const indexSource = readFileSync(`${pkgRoot}src/index.ts`, "utf8");
    expect(toolSource).toContain('exposure: "codemode"');
    expect(indexSource).toContain("pi.registerTool(createLangTool(");
    expect(indexSource).toContain('tool.name === "codemode"');
    expect(indexSource).toContain('pi.on("session_start"');
  });

  it("keeps the workspace and lockfile entries consistent", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const lock = JSON.parse(
      readFileSync(`${repoRoot}package-lock.json`, "utf8"),
    );
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(root.workspaces).toContain("extensions/*");
    expect(lock.packages["extensions/pi-language-tools"]).toMatchObject({
      name: "@hollowheap/pi-language-tools",
      version: pkg.version,
    });
    expect(pkg.pi.extensions).toContain("./index.ts");
  });

  it("declares the ten documented actions in the tool schema", () => {
    const source = readFileSync(`${pkgRoot}src/tool.ts`, "utf8");
    for (const action of [
      "definition",
      "references",
      "document_symbols",
      "workspace_symbols",
      "hover",
      "signature_help",
      "type_definition",
      "implementation",
      "document_highlights",
      "diagnostics",
    ]) {
      expect(source).toContain(`Type.Literal("${action}")`);
    }
  });
});
