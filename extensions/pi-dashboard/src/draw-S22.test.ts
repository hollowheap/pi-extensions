import { describe, expect, it, vi } from "vitest";
import { createDashboard } from "./index.js";
import { fitLines } from "./render.js";

describe("S22: dashboard abort and width handling", () => {
  it("aborts in-flight commands on stop and fits lines to the requested width", async () => {
    let captured: AbortSignal | undefined;
    const deps = {
      run: vi.fn(
        async (
          _command: string,
          _args: string[],
          signal: AbortSignal | undefined,
        ) => {
          captured = signal;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return "late\n";
        },
      ),
      notify: vi.fn(),
    };
    const controller = createDashboard(
      {
        width: 5,
        sections: [
          { type: "terminal", command: "x", args: [], intervalMs: 50, gap: 0 },
        ],
      },
      deps,
    );
    const renderRequest = vi.fn();
    controller.start(renderRequest);
    const pending = controller.refresh();
    controller.stop();
    expect(captured?.aborted).toBe(true);
    await pending;
    expect(renderRequest).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();

    const header = createDashboard(
      {
        width: 5,
        sections: [{ type: "header", ascii: ["hi"], gap: 0 }],
      },
      deps,
    );
    expect(header.lines()).toEqual([" hi  "]);
    expect(header.lines(9)).toEqual(["   hi    "]);
    expect(fitLines(["hi"], 5)).toEqual(["hi   "]);
  });
});
