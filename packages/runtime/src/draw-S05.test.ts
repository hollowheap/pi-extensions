import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { displayTarget, truncateText } from "../../core/src/format.js";
import { runBinary } from "./exec.js";

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
