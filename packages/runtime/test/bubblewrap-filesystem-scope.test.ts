import { describe, expect, it } from "vitest";
import {
  assertBwrapAvailable,
  buildSandboxArgs,
  probeBwrapAvailability,
  wrapSandboxCommand,
} from "../src/sandbox.js";

describe("bubblewrap sandbox wrapping", () => {
  it("binds only the workspace writable and masks sensitive paths offline", () => {
    const args = buildSandboxArgs({
      workspace: "/work",
      offline: true,
      filterExisting: false,
      maskPaths: ["/home/u/.ssh"],
    });
    expect(args.slice(0, 5)).toEqual([
      "--die-with-parent",
      "--new-session",
      "--unshare-pid",
      "--ro-bind",
      "/",
    ]);
    expect(args).toContain("--dev");
    expect(args).toContain("--proc");
    expect(args).toContain("--tmpfs");
    expect(args).toContain("--bind");
    expect(args).toContain("/work");
    expect(args).toContain("/home/u/.ssh");
    expect(args).toContain("--unshare-net");
  });

  it("defaults bind the current directory and allow the network", () => {
    const args = buildSandboxArgs();
    expect(args.slice(0, 12)).toEqual([
      "--die-with-parent",
      "--new-session",
      "--unshare-pid",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
    ]);
    expect(args).toContain(process.cwd());
    expect(args).not.toContain("--unshare-net");
  });

  it("a missing bwrap binary fails closed with a clear error", () => {
    const missing = "/definitely/not/here/bwrap";
    expect(probeBwrapAvailability(missing)).toMatchObject({
      available: false,
      reason: "missing",
    });
    expect(() => assertBwrapAvailable(missing)).toThrow(/not found on PATH/);
  });

  it("wrapping appends the command and its arguments after a separator", () => {
    const wrapped = wrapSandboxCommand("echo", ["hello"], {
      bwrapBinary: process.execPath,
      workspace: "/tmp",
      maskPaths: [],
      offline: true,
    });
    expect(wrapped.command).toBe(process.execPath);
    expect(wrapped.args).toContain("--unshare-net");
    expect(wrapped.args.slice(-3)).toEqual(["--", "echo", "hello"]);
  });
});
