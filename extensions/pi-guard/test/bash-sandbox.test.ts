import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBwrapAvailable } from "@hollowheap/runtime/sandbox";
import { afterEach, describe, expect, it } from "vitest";
import { createSandboxedBashOperations } from "../src/sandbox.js";
import { loadGuardSandboxOptions } from "../src/settings.js";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("main-agent bash sandboxing", () => {
  it("loads sandbox backend and image options from guard.json", () => {
    const agentDir = tempDir("pi-guard-sb-");
    writeFileSync(
      join(agentDir, "guard.json"),
      JSON.stringify({
        trustedRoots: [],
        decisions: {},
        sandbox: { enabled: true, backend: "podman", image: "node:22-alpine" },
      }),
    );
    expect(loadGuardSandboxOptions(agentDir)).toEqual({
      backend: "podman",
      image: "node:22-alpine",
    });
  });

  it("runs locally when sandbox is disabled", async () => {
    const workDir = tempDir("pi-guard-work-");
    const agentDir = tempDir("pi-guard-agent-");
    const ops = createSandboxedBashOperations(
      () => undefined,
      () => agentDir,
    );
    let output = "";
    const res = await ops.exec("echo hello-local", workDir, {
      onData: (chunk) => {
        output += chunk.toString("utf8");
      },
    });
    expect(res.exitCode).toBe(0);
    expect(output.trim()).toBe("hello-local");
  });

  it("wraps bash in bwrap with workspace and agentDir writable when enabled", async () => {
    if (!isBwrapAvailable()) return;
    const workDir = tempDir("pi-guard-work-");
    const agentDir = tempDir("pi-guard-agent-");
    const outsideDir = tempDir("pi-guard-outside-");
    const ops = createSandboxedBashOperations(
      () => ({ backend: "bwrap" }),
      () => agentDir,
    );

    let output = "";
    const okRes = await ops.exec(
      `touch "${workDir}/w.txt" && touch "${agentDir}/a.txt" && echo ok`,
      workDir,
      {
        onData: (chunk) => {
          output += chunk.toString("utf8");
        },
      },
    );
    expect(okRes.exitCode).toBe(0);
    expect(output.trim()).toBe("ok");

    let errOutput = "";
    const deniedRes = await ops.exec(
      `touch "${outsideDir}/blocked.txt"`,
      workDir,
      {
        onData: (chunk) => {
          errOutput += chunk.toString("utf8");
        },
      },
    );
    expect(deniedRes.exitCode).not.toBe(0);
    expect(errOutput).toMatch(
      /Read-only file system|Permission denied|No such file or directory/i,
    );
  });
});
