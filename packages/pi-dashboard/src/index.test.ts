import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setCwd } from "@hollowheap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "./exec.js";
import extension, { createDashboard } from "./index.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => state.agentDir,
}));

vi.mock("./exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exec.js")>();
  return { ...actual, runCommand: vi.fn(actual.runCommand) };
});

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    cwd: tmpdir(),
    sessionManager: {},
    ui: { setHeader: vi.fn(), notify: vi.fn() },
    ...overrides,
  };
}

function installHeader(
  pi: ReturnType<typeof createMockPi>,
  ctx: ReturnType<typeof createMockCtx>,
) {
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  handlers.session_start(undefined as never, ctx as never);
  expect(ctx.ui.setHeader).toHaveBeenCalledTimes(1);
  const factory = ctx.ui.setHeader.mock.calls[0][0];
  const tui = { requestRender: vi.fn() };
  return factory(tui, {});
}

describe("pi-dashboard extension", () => {
  it("runs terminal sections in the effective cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dash-"));
    writeFileSync(
      join(dir, "dashboard.json"),
      JSON.stringify({
        sections: [{ type: "terminal", command: "echo hi", intervalMs: 60000 }],
      }),
    );
    state.agentDir = dir;
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    setCwd(ctx.sessionManager, join(dir, "sub"));
    installHeader(pi, ctx);
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalled());
    expect(vi.mocked(runCommand).mock.calls[0][2]).toBe(join(dir, "sub"));
  });

  it("installs the default banner on session_start in tui mode", () => {
    const pi = createMockPi();
    extension(pi as never);
    const component = installHeader(pi, createMockCtx());
    const lines = component.render(60);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(60);
    }
    for (const line of component.render(40)) {
      expect(visibleWidth(line)).toBe(40);
    }
  });

  it("skips the header outside tui mode", () => {
    const pi = createMockPi();
    extension(pi as never);
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    const ctx = createMockCtx({ mode: "print" });
    handlers.session_start(undefined as never, ctx as never);
    expect(ctx.ui.setHeader).not.toHaveBeenCalled();
  });

  it("clears the header on session_shutdown", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    installHeader(pi, ctx);
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    handlers.session_shutdown(undefined as never, ctx as never);
    expect(ctx.ui.setHeader).toHaveBeenLastCalledWith(undefined);
  });
});

describe("createDashboard", () => {
  function fakeDeps(stdout: string, notify = vi.fn()) {
    return {
      run: vi.fn(async () => stdout),
      notify,
    };
  }

  it("serves ascii lines without running anything", async () => {
    const deps = fakeDeps("");
    const controller = createDashboard(
      {
        width: 5,
        sections: [{ type: "header", ascii: ["hi"], gap: 1 }],
      },
      deps,
    );
    expect(controller.lines()).toEqual([" hi  ", ""]);
    await controller.refresh();
    expect(deps.run).not.toHaveBeenCalled();
    const renderRequest = vi.fn();
    controller.start(renderRequest);
    controller.stop();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("re-centers the header when the render width changes", () => {
    const deps = fakeDeps("");
    const controller = createDashboard(
      {
        width: 5,
        sections: [{ type: "header", ascii: ["hi"], gap: 0 }],
      },
      deps,
    );
    expect(controller.lines()).toEqual([" hi  "]);
    expect(controller.lines(9)).toEqual(["   hi    "]);
    expect(controller.lines(5)).toEqual([" hi  "]);
  });

  it("refreshes command output and re-renders", async () => {
    const deps = fakeDeps("a\nb\n");
    const controller = createDashboard(
      {
        width: 5,
        sections: [
          { type: "terminal", command: "x", args: [], intervalMs: 50, gap: 0 },
        ],
      },
      deps,
    );
    expect(controller.lines()).toEqual([]);
    const renderRequest = vi.fn();
    controller.start(renderRequest);
    await controller.refresh();
    expect(controller.lines()).toEqual(["a    ", "b    "]);
    expect(renderRequest).toHaveBeenCalled();
    controller.stop();
  });

  it("aborts in-flight commands on stop and skips the render", async () => {
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
  });

  it("passes the render width to the terminal section", async () => {
    const deps = fakeDeps("a\n");
    const controller = createDashboard(
      {
        width: 5,
        sections: [
          { type: "terminal", command: "x", args: [], intervalMs: 50, gap: 0 },
        ],
      },
      deps,
    );
    controller.start(vi.fn());
    await controller.refresh();
    expect(controller.lines(9)[0]).toHaveLength(9);
    controller.stop();
  });

  it("stacks sections with gaps", async () => {
    const deps = fakeDeps("b\n");
    const controller = createDashboard(
      {
        width: 4,
        sections: [
          { type: "header", ascii: ["a"], gap: 1 },
          { type: "terminal", command: "x", args: [], intervalMs: 50, gap: 0 },
        ],
      },
      deps,
    );
    await controller.refresh();
    expect(controller.lines()).toEqual([" a  ", "", "b   "]);
    controller.stop();
  });

  it("shows failures once and keeps the message", async () => {
    const notify = vi.fn();
    const controller = createDashboard(
      {
        width: 40,
        sections: [
          { type: "terminal", command: "x", args: [], intervalMs: 50, gap: 0 },
        ],
      },
      {
        run: async () => {
          throw new Error("command not found: x");
        },
        notify,
      },
    );
    await controller.refresh();
    await controller.refresh();
    expect(controller.lines().join()).toContain("command not found: x");
    expect(notify).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("starts one interval timer and stops it", () => {
    const setSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation((() => 1) as unknown as typeof setInterval);
    const clearSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation((() => undefined) as unknown as typeof clearInterval);
    try {
      const controller = createDashboard(
        {
          width: 5,
          sections: [
            {
              type: "terminal",
              command: "x",
              args: [],
              intervalMs: 10,
              gap: 0,
            },
          ],
        },
        fakeDeps(""),
      );
      controller.start(() => {});
      controller.start(() => {});
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 10);
      controller.stop();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it("runs real commands end to end", async () => {
    const controller = createDashboard(
      {
        width: 10,
        sections: [
          {
            type: "terminal",
            command: process.execPath,
            args: ["-e", "console.log('hi')"],
            intervalMs: 50,
            gap: 0,
          },
        ],
      },
      {
        run: (command, args, signal) =>
          runCommand(command, args, tmpdir(), signal),
        notify: () => {},
      },
    );
    await controller.refresh();
    expect(controller.lines()).toEqual(["hi        "]);
  });
});
