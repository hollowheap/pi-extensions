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

  it("S102 C02: documents the numeric ranges and their defaults", () => {
    const packageReadme = readFileSync(
      resolve(process.cwd(), "extensions/pi-subagents/README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("1–8, default 4");
    expect(packageReadme).toContain("1–3, default 1");
    expect(packageReadme).toContain("writeLockTimeoutMs");
  });

  it("S102 C03: documents ACP inactivity and the no-auto-resume limitation", () => {
    const packageReadme = readFileSync(
      resolve(process.cwd(), "extensions/pi-subagents/README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("PI_ACP");
    expect(packageReadme).toMatch(/No automatic resume/);
  });

  it("S102 C04: documents the action table and recovery semantics", () => {
    const packageReadme = readFileSync(
      resolve(process.cwd(), "extensions/pi-subagents/README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("## Recovery");
    expect(packageReadme).toContain("increments");
    expect(packageReadme).toContain("`resume`");
  });
});
