import { describe, expect, it } from "vitest";
import { evaluate } from "../src/modes.js";
import { checkPath } from "../src/policy.js";

describe("deny precedence", () => {
  it("lets a broad deny beat a more specific allow regardless of rule order", () => {
    const deny = { tag: "edit", pattern: "*.ts", effect: "deny" } as const;
    const allow = {
      tag: "edit",
      pattern: "src/*.ts",
      effect: "allow",
    } as const;

    expect(checkPath([deny, allow], "src/a.ts", "edit", "/repo")).toBe("deny");
    expect(checkPath([allow, deny], "src/a.ts", "edit", "/repo")).toBe("deny");
  });

  it("with no rules a path falls back to ask", () => {
    expect(checkPath([], "src/a.ts", "edit", "/repo")).toBe("ask");
  });

  it("a path outside the root is denied even with a broad allow", () => {
    const broadAllow = { tag: "read", pattern: "**", effect: "allow" } as const;
    expect(checkPath([broadAllow], "/etc/passwd", "read", "/repo")).toBe(
      "deny",
    );
  });

  it("a core deny rule drives the mode evaluator to deny", () => {
    const deny = { tag: "edit", pattern: "src/**", effect: "deny" } as const;
    expect(
      evaluate({
        owner: {},
        cwd: "/repo",
        tag: "edit",
        target: "src/a.ts",
        rules: [deny],
      }),
    ).toBe("deny");
  });
});
