import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBinary, runCapture } from "./exec.js";
import {
  DEFAULT_MASK_PATHS,
  assertBwrapAvailable,
  buildSandboxArgs,
  isBwrapAvailable,
  wrapSandboxCommand,
} from "./sandbox.js";

const bwrapAvailable = isBwrapAvailable();

describe("isBwrapAvailable & assertBwrapAvailable", () => {
  it("checks binary availability", () => {
    expect(typeof isBwrapAvailable()).toBe("boolean");
    expect(isBwrapAvailable("nonexistent-bwrap-binary-xyz")).toBe(false);
  });

  it("assertBwrapAvailable throws on missing binary", () => {
    expect(() => assertBwrapAvailable("nonexistent-bwrap-binary-xyz")).toThrow(
      "Bubblewrap sandbox is required but 'nonexistent-bwrap-binary-xyz' was not found on PATH",
    );
  });

  if (bwrapAvailable) {
    it("assertBwrapAvailable succeeds when bwrap is found", () => {
      expect(() => assertBwrapAvailable()).not.toThrow();
    });
  }
});

describe("buildSandboxArgs", () => {
  it("builds standard bubblewrap sandbox arguments", () => {
    const cwd = "/test/workspace";
    const args = buildSandboxArgs({
      cwd,
      maskPaths: ["/home/user/.ssh", "/home/user/.gnupg"],
    });

    expect(args).toEqual([
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
      "--bind",
      cwd,
      cwd,
      "--tmpfs",
      "/home/user/.ssh",
      "--tmpfs",
      "/home/user/.gnupg",
    ]);
  });

  it("prioritizes workspace option over cwd", () => {
    const args = buildSandboxArgs({
      cwd: "/test/workspace/sub",
      workspace: "/test/workspace",
      maskPaths: [],
    });

    expect(args).toContain("/test/workspace");
    const bindIndex = args.indexOf("--bind");
    expect(bindIndex).toBeGreaterThanOrEqual(0);
    expect(args[bindIndex + 1]).toBe("/test/workspace");
    expect(args[bindIndex + 2]).toBe("/test/workspace");
  });

  it("masks default paths (~/.ssh, ~/.gnupg)", () => {
    const args = buildSandboxArgs({ cwd: tmpdir() });
    for (const mask of DEFAULT_MASK_PATHS) {
      if (existsSync(mask)) {
        expect(args).toContain(mask);
      }
    }
  });

  it("passes network by default and restricts when offline", () => {
    const onlineArgs = buildSandboxArgs({ cwd: tmpdir(), maskPaths: [] });
    expect(onlineArgs).not.toContain("--unshare-net");

    const offlineArgs = buildSandboxArgs({
      cwd: tmpdir(),
      offline: true,
      maskPaths: [],
    });
    expect(offlineArgs).toContain("--unshare-net");

    const noNetworkArgs = buildSandboxArgs({
      cwd: tmpdir(),
      network: false,
      maskPaths: [],
    });
    expect(noNetworkArgs).toContain("--unshare-net");
  });
});

describe("wrapSandboxCommand", () => {
  it("wraps a target command with delimiter and bwrap binary", () => {
    if (!bwrapAvailable) return;
    const cwd = tmpdir();
    const wrapped = wrapSandboxCommand("ls", ["-la"], {
      cwd,
      maskPaths: ["/mock/.ssh"],
    });

    expect(wrapped.command).toBe("bwrap");
    expect(wrapped.args).toEqual([
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
      "--bind",
      cwd,
      cwd,
      "--tmpfs",
      "/mock/.ssh",
      "--",
      "ls",
      "-la",
    ]);
  });

  it("throws when working directory does not exist", () => {
    if (!bwrapAvailable) return;
    expect(() =>
      wrapSandboxCommand("ls", [], { cwd: "/nonexistent-working-dir-xyz" }),
    ).toThrow("working directory does not exist: /nonexistent-working-dir-xyz");
  });

  it("fails closed when bwrap binary is missing", () => {
    expect(() =>
      wrapSandboxCommand("ls", [], {
        cwd: tmpdir(),
        bwrapBinary: "missing-bwrap-test",
      }),
    ).toThrow(
      "Bubblewrap sandbox is required but 'missing-bwrap-test' was not found on PATH",
    );
  });
});

describe("sandboxed command execution", () => {
  if (!bwrapAvailable) {
    it.skip("skips execution tests when bwrap is not available on host", () => {});
    return;
  }

  it("executes command via runCapture with sandbox: true", async () => {
    const result = await runCapture(
      "echo",
      ["hello", "sandbox"],
      tmpdir(),
      undefined,
      { sandbox: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello sandbox");
  });

  it("executes command via runBinary with sandbox: true", async () => {
    const stdout = await runBinary(
      "echo",
      ["from", "runBinary"],
      tmpdir(),
      undefined,
      { sandbox: true },
    );

    expect(stdout.trim()).toBe("from runBinary");
  });

  it("fails closed without fallback if sandbox is requested with missing bwrap", async () => {
    await expect(
      runCapture("echo", ["hi"], tmpdir(), undefined, {
        sandbox: { bwrapBinary: "missing-bwrap-test" },
      }),
    ).rejects.toThrow("Bubblewrap sandbox is required");
  });

  it("enforces read-only root: writing outside workspace fails", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pi-sandbox-test-"));
    try {
      const result = await runCapture(
        "touch",
        ["/nonexistent_root_target"],
        testDir,
        undefined,
        { sandbox: true },
      );

      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/read-only file system/i);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("allows writing inside the workspace directory", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pi-sandbox-rw-"));
    try {
      const testFile = join(testDir, "test.txt");
      const result = await runCapture("touch", [testFile], testDir, undefined, {
        sandbox: true,
      });

      expect(result.code).toBe(0);
      expect(existsSync(testFile)).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("masks sensitive directories such as ~/.ssh", async () => {
    const sshDir = join(homedir(), ".ssh");
    if (!existsSync(sshDir)) {
      return;
    }

    const result = await runCapture("ls", ["-A", sshDir], tmpdir(), undefined, {
      sandbox: true,
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("isolates network namespace when offline is requested", async () => {
    const result = await runCapture("ip", ["link"], tmpdir(), undefined, {
      sandbox: { offline: true },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("lo:");
    expect(result.stdout).not.toContain("eth0");
    expect(result.stdout).not.toContain("wlan0");
  });
});
