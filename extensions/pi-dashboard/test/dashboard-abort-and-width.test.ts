import { describe, expect, it, vi } from "vitest";
import { createDashboard } from "../src/index.js";
import { fitLines, splitOutput } from "../src/render.js";

describe("dashboard abort and width handling", () => {
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

describe("width boundary, command failure and output-to-render flow", () => {
  it("fitLines centers short lines and truncates long ones", () => {
    expect(fitLines(["hi"], 5, "center")).toEqual([" hi  "]);
    expect(fitLines(["abcdef"], 3)[0]).toContain("...");
  });

  it("a failing terminal command reports one error and shows the message", async () => {
    const deps = {
      run: vi.fn(async () => {
        throw new Error("boom");
      }),
      notify: vi.fn(),
    };
    const controller = createDashboard(
      {
        width: 10,
        sections: [
          {
            type: "terminal",
            command: "x",
            args: [],
            intervalMs: 100000,
            gap: 0,
          },
        ],
      },
      deps,
    );
    controller.start(vi.fn());
    await controller.refresh();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith("boom");
    expect(controller.lines().join("")).toContain("boom");
    controller.stop();
  });

  it("splitOutput strips terminal escapes before lines are fitted", () => {
    const lines = splitOutput("a\u001b[2Jb\nc\n");
    expect(lines).toEqual(["ab", "c"]);
    expect(fitLines(lines, 4)).toEqual(["ab  ", "c   "]);
  });
});
