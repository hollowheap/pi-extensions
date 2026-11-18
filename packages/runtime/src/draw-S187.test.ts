import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cancelProcessGroup,
  isProcessAlive,
  signalProcessGroup,
  spawnDetachedProcess,
} from "./process.js";

describe("S187 process-group signalling", () => {
  it("signals the whole process group with a negative pid", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      expect(signalProcessGroup(4321, "SIGTERM")).toBe(true);
      expect(kill).toHaveBeenCalledWith(-4321, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });

  it("S187 C02: an invalid pid is refused without calling process.kill", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      expect(signalProcessGroup(0, "SIGTERM")).toBe(false);
      expect(signalProcessGroup(-5, "SIGTERM")).toBe(false);
      expect(signalProcessGroup(1.5, "SIGTERM")).toBe(false);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it("S187 C03: a failed group signal falls back to the leader pid", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid < 0) throw new Error("no such group");
      return true;
    });
    try {
      expect(signalProcessGroup(4321, "SIGTERM")).toBe(true);
      expect(kill).toHaveBeenCalledWith(-4321, "SIGTERM");
      expect(kill).toHaveBeenCalledWith(4321, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });

  it("S187 C04: cancelProcessGroup drives the group teardown to completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s187-teardown-"));
    const child = spawnDetachedProcess({
      command: "sleep",
      args: ["30"],
      logPath: join(dir, "child.log"),
    });
    try {
      await expect(
        cancelProcessGroup(child.pid, child.startTime, 50),
      ).resolves.toBe(true);
      expect(isProcessAlive(child.pid, child.startTime)).toBe(false);
    } finally {
      await cancelProcessGroup(child.pid, child.startTime, 50);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
