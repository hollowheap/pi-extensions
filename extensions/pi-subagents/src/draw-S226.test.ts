import { describe, expect, it } from "vitest";
import { subagentDisplayName } from "./state.js";

describe("S226: harness categories recorded without ACP", () => {
  it("S226 C01: harness identity is preserved in display", () => {
    expect(
      subagentDisplayName({
        agent: "scout",
        model: undefined,
        task: "t",
      } as never),
    ).toContain("scout");
  });
});
