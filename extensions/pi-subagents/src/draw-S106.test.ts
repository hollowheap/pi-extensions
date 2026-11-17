import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubagentsExtension } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("S106 ACP inactivity", () => {
  it("registers no tool and starts no children under PI_ACP", () => {
    vi.stubEnv("PI_ACP", "1");
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      on: vi.fn(),
      events: { emit: vi.fn() },
    };
    createSubagentsExtension()(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });
});
