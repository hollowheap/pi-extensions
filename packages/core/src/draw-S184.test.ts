import { describe, expect, it } from "vitest";
import { checkPath } from "./policy.js";

describe("S184 deny precedence", () => {
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
});
