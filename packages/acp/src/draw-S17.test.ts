import { describe, expect, it } from "vitest";
import { piRpcArgs } from "./pi-rpc.js";

describe("S17: spawned pi command line", () => {
  it("includes -nbt alongside -ne and the bundled extension after -e", () => {
    const args = piRpcArgs({
      cwd: "/tmp/work",
      socketPath: "/tmp/s.sock",
      caps: "{}",
      extensionPath: "/tmp/ext.ts",
      appendix: "appendix",
      onEvent: () => {},
    });
    expect(args).toContain("-nbt");
    expect(args).toContain("-ne");
    expect(args[args.indexOf("-e") + 1]).toBe("/tmp/ext.ts");
    expect(args).not.toContain("--session");
  });
});
