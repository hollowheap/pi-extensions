import { describe, expect, it } from "vitest";
import { buildSandboxArgs } from "./sandbox.js";

describe("S120 bubblewrap sandbox wrapping", () => {
  it("binds only the workspace writable and masks sensitive paths offline", () => {
    const args = buildSandboxArgs({
      workspace: "/work",
      offline: true,
      filterExisting: false,
      maskPaths: ["/home/u/.ssh"],
    });
    expect(args.slice(0, 2)).toEqual(["--ro-bind", "/"]);
    expect(args).toContain("--dev");
    expect(args).toContain("--proc");
    expect(args).toContain("--tmpfs");
    expect(args).toContain("--bind");
    expect(args).toContain("/work");
    expect(args).toContain("/home/u/.ssh");
    expect(args).toContain("--unshare-net");
  });
});
