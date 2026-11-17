import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("S102 subagent documentation", () => {
  it("documents the configuration limits in both package and root READMEs", () => {
    const root = process.cwd();
    const packageReadme = readFileSync(
      resolve(root, "extensions/pi-subagents/README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("maxConcurrent");
    const rootReadme = readFileSync(resolve(root, "README.md"), "utf8");
    expect(rootReadme).toContain("pi-subagents");
  });
});
