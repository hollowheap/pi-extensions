import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S74: pi-tasks README documents the direct task tool", () => {
  it("covers all actions, durable state, and the bash safeguard", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    for (const word of ["start", "list", "status", "wait", "cancel"]) {
      expect(readme).toContain(word);
    }
    expect(readme).toContain("bash");
    expect(readme).toContain("0600");
  });
});
