import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXT = `${ROOT}packages/acp/src/extension/`;

describe("S16: ACP extension consumes core instead of local policy code", () => {
  it("imports core verdicts and ships no local rules, loader, bash, modes or exec module", () => {
    const entry = readFileSync(`${EXT}index.ts`, "utf8");
    expect(entry).toContain("@hollowheap/core/modes");
    expect(entry).toContain("evaluate");

    const files = readdirSync(EXT).filter((name) => name.endsWith(".ts"));
    for (const forbidden of [
      "rules.ts",
      "loader.ts",
      "bash.ts",
      "modes.ts",
      "exec.ts",
    ]) {
      expect(files).not.toContain(forbidden);
    }

    const forbiddenSymbols = new RegExp(
      `${["check", "Bash"].join("")}|${["load", "Rules"].join("")}|${["function", "decide"].join(" ")}`,
    );
    const sources = readdirSync(`${ROOT}packages/acp/src`)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(`${ROOT}packages/acp/src/${name}`, "utf8"));
    expect(sources.some((text) => forbiddenSymbols.test(text))).toBe(false);
  });
});

describe("S16: core subpath imports, no local policy modules and delegation", () => {
  it("S16 C02: every core import in the extension uses a subpath", () => {
    const files = readdirSync(EXT).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    let imports = 0;
    for (const file of files) {
      const source = readFileSync(`${EXT}${file}`, "utf8");
      for (const match of source.matchAll(
        /from\s+["']@hollowheap\/core([^"']*)["']/g,
      )) {
        expect(match[1]).toMatch(/^\//);
        imports += 1;
      }
    }
    expect(imports).toBeGreaterThan(0);
  });

  it("S16 C03: no extension file imports a local policy or shell module", () => {
    const localPolicy = /from\s+["']\.\/(rules|loader|bash|modes|exec)\.js["']/;
    for (const file of readdirSync(EXT).filter((name) =>
      name.endsWith(".ts"),
    )) {
      expect(readFileSync(`${EXT}${file}`, "utf8")).not.toMatch(localPolicy);
    }
  });

  it("S16 C04: the extension permissions module delegates to core config and trust", () => {
    const source = readFileSync(`${EXT}permissions.ts`, "utf8");
    expect(source).toContain('from "@hollowheap/core/config"');
    expect(source).toContain("loadPermissions as loadCorePermissions");
    expect(source).toContain('from "@hollowheap/core/trust"');
    expect(source).toContain("loadGuardTrust");
  });
});
