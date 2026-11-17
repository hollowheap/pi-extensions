import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return { registerTool: vi.fn(), on: vi.fn() };
}

describe("S92 pi-decide tool exposure", () => {
  it("registers exactly one direct decide tool", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool).toMatchObject({ name: "decide", exposure: "direct" });
  });
});
