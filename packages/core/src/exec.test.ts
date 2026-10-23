import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runBinary, runCapture } from "./exec.js";

const node = process.execPath;

describe("runCapture", () => {
  it("captures a nonzero exit without throwing", async () => {
    await expect(
      runCapture(
        node,
        [
          "-e",
          "process.stdout.write('out');process.stderr.write('err');process.exit(3)",
        ],
        tmpdir(),
        undefined,
      ),
    ).resolves.toEqual({ code: 3, stdout: "out", stderr: "err" });
  });

  it("passes stdin to the command", async () => {
    const result = await runCapture(
      node,
      [
        "-e",
        "process.stdin.on('data',(d)=>process.stdout.write(d.toString().toUpperCase()))",
      ],
      tmpdir(),
      undefined,
      { input: "hello" },
    );
    expect(result.stdout).toBe("HELLO");
  });

  it("rejects when the command cannot start", async () => {
    await expect(
      runCapture("pi-core-missing-binary", [], tmpdir(), undefined),
    ).rejects.toThrow("command not found: pi-core-missing-binary");
  });

  it("rejects when the command is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runCapture(
        node,
        ["-e", "setTimeout(() => {}, 1000)"],
        tmpdir(),
        controller.signal,
      ),
    ).rejects.toThrow(/abort/i);
  });
});

describe("runBinary", () => {
  it("returns stdout", async () => {
    await expect(
      runBinary(node, ["-e", "console.log('hi')"], tmpdir(), undefined),
    ).resolves.toBe("hi\n");
  });

  it("accepts configured exit codes", async () => {
    await expect(
      runBinary(
        node,
        ["-e", "process.stdout.write('found');process.exit(1)"],
        tmpdir(),
        undefined,
        { okExitCodes: [1] },
      ),
    ).resolves.toBe("found");
  });

  it("rejects other nonzero exits with stderr", async () => {
    await expect(
      runBinary(
        node,
        ["-e", "process.stderr.write('boom');process.exit(2)"],
        tmpdir(),
        undefined,
      ),
    ).rejects.toThrow("failed: boom");
  });

  it("reports a missing binary", async () => {
    await expect(
      runBinary("pi-core-missing-binary", [], tmpdir(), undefined),
    ).rejects.toThrow("command not found: pi-core-missing-binary");
  });

  it("reports a missing working directory before the binary", async () => {
    await expect(
      runBinary(
        "pi-core-missing-binary",
        [],
        "/tmp/pi-core-missing-dir",
        undefined,
      ),
    ).rejects.toThrow("working directory does not exist");
  });

  it("aborts on the signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runBinary(
        node,
        ["-e", "setTimeout(() => {}, 1000)"],
        tmpdir(),
        controller.signal,
      ),
    ).rejects.toThrow(/abort/i);
  });

  it("bounds stdout with maxBuffer", async () => {
    await expect(
      runBinary(
        node,
        ["-e", "process.stdout.write('x'.repeat(1000))"],
        tmpdir(),
        undefined,
        { maxBuffer: 100 },
      ),
    ).rejects.toThrow(/maxBuffer/i);
  });
});
