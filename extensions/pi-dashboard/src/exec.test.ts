import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCommand } from "./exec.js";

describe("runCommand", () => {
  it("reports a clear error when the binary is missing", async () => {
    await expect(
      runCommand("pi-dashboard-missing-binary", [], tmpdir(), undefined),
    ).rejects.toThrow("command not found");
  });

  it("reports a missing working directory", async () => {
    await expect(
      runCommand(
        process.execPath,
        ["-e", "1"],
        "/tmp/pi-dashboard-missing-dir",
        undefined,
      ),
    ).rejects.toThrow("does not exist");
  });

  it("returns stdout", async () => {
    await expect(
      runCommand(
        process.execPath,
        ["-e", "console.log('hi')"],
        tmpdir(),
        undefined,
      ),
    ).resolves.toBe("hi\n");
  });
});
