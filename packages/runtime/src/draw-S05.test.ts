import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { displayTarget, truncateText } from "../../core/src/format.js";
import { runBinary, runCapture } from "./exec.js";

describe("S05: shared execution and formatting helpers", () => {
  it("bounds output, honors abort and okExitCodes, and reports spawn failures", async () => {
    const node = process.execPath;
    await expect(
      runBinary(node, ["-e", "console.log('hi')"], tmpdir(), undefined),
    ).resolves.toBe("hi\n");
    await expect(
      runBinary(
        node,
        ["-e", "process.stdout.write('found');process.exit(1)"],
        tmpdir(),
        undefined,
        { okExitCodes: [1] },
      ),
    ).resolves.toBe("found");
    await expect(
      runBinary(
        node,
        ["-e", "process.stdout.write('x'.repeat(1000))"],
        tmpdir(),
        undefined,
        { maxBuffer: 100 },
      ),
    ).rejects.toThrow(/maxBuffer/i);
    await expect(
      runBinary("pi-core-missing-binary", [], tmpdir(), undefined),
    ).rejects.toThrow("command not found");
    await expect(
      runBinary(
        "pi-core-missing-binary",
        [],
        "/tmp/pi-core-missing-dir",
        undefined,
      ),
    ).rejects.toThrow("working directory does not exist");
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

    const long = `${"a".repeat(3000)}${"b".repeat(1000)}${"c".repeat(1000)}`;
    expect(truncateText(long)).toContain("[truncated: cut 1000 characters]");
    expect(displayTarget("x".repeat(600))).toContain("[… cut 100 characters]");
  });
});

describe("S05: truncation thresholds, exit reporting and exec-to-format flow", () => {
  it("S05 C02: truncation leaves inputs at or below the threshold untouched", () => {
    expect(truncateText("a".repeat(4000))).toBe("a".repeat(4000));
    expect(truncateText("a".repeat(4001))).toContain("cut 1 characters");
    expect(displayTarget("b".repeat(500))).toBe("b".repeat(500));
    expect(displayTarget("b".repeat(501))).toContain("cut 1 characters");
  });

  it("S05 C03: runCapture reports a nonzero exit and stderr instead of throwing", async () => {
    const node = process.execPath;
    const result = await runCapture(
      node,
      ["-e", "process.stderr.write('bad');process.exit(7)"],
      tmpdir(),
      undefined,
    );
    expect(result.code).toBe(7);
    expect(result.stderr).toBe("bad");
    await expect(
      runBinary(node, ["-e", "process.exit(7)"], tmpdir(), undefined),
    ).rejects.toThrow("exit code 7");
  });

  it("S05 C04: captured stdout feeds the shared truncation helper", async () => {
    const node = process.execPath;
    const output = await runBinary(
      node,
      ["-e", "process.stdout.write('z'.repeat(5000))"],
      tmpdir(),
      undefined,
    );
    expect(output).toHaveLength(5000);
    const truncated = truncateText(output);
    expect(truncated).toContain("[truncated: cut 1000 characters]");
    expect(truncated).toContain("z".repeat(1000));
  });
});
