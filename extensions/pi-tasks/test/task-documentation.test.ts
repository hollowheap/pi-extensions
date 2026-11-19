import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("pi-tasks README documents the direct task tool", () => {
  it("covers all actions, durable state, and the bash safeguard", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    for (const word of ["start", "list", "status", "wait", "cancel"]) {
      expect(readme).toContain(word);
    }
    expect(readme).toContain("bash");
    expect(readme).toContain("0600");
  });

  it("documents the trust gate and ACP inactivity", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("Project trust gate");
    expect(readme).toContain("isProjectTrusted() === true");
    expect(readme).toContain("ACP inactivity");
    expect(readme).toContain("PI_ACP");
    expect(readme).toContain("acp_bash");
  });

  it("documents wait bounds and cancel signals", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("30000");
    expect(readme).toContain("600000");
    expect(readme).toContain("SIGTERM");
    expect(readme).toContain("SIGKILL");
  });

  it("documents PID reconciliation and shared runtime primitives", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("PID-reuse");
    expect(readme).toContain("startTime");
    expect(readme).toContain("LockedProcessStore");
    expect(readme).toContain("spawnDetachedTask");
  });
});
