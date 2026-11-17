import { describe, expect, it, vi } from "vitest";
import { signalProcessGroup } from "./process.js";

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
});
