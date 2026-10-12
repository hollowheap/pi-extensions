import { tmpdir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { runCommand } from "./exec.js";
import extension, { createDashboard } from "./index.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

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
  it("installs the default banner on session_start in tui mode", () => {
    const pi = createMockPi();
    extension(pi as never);
    const component = installHeader(pi, createMockCtx());
    const lines = component.render(0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(60);
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
      { width: 5, intervalMs: 50, source: { kind: "ascii", lines: ["hi"] } },
      deps,
    );
    expect(controller.lines()).toEqual([" hi  "]);
    await controller.refresh();
    expect(deps.run).not.toHaveBeenCalled();
    const renderRequest = vi.fn();
    controller.start(renderRequest);
    controller.stop();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("refreshes command output and re-renders", async () => {
    const deps = fakeDeps("a\nb\n");
    const controller = createDashboard(
      {
        width: 5,
        intervalMs: 50,
        source: { kind: "command", command: "x", args: [] },
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

  it("shows failures once and keeps the message", async () => {
    const notify = vi.fn();
    const controller = createDashboard(
      {
        width: 40,
        intervalMs: 50,
        source: { kind: "command", command: "x", args: [] },
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
          intervalMs: 10,
          source: { kind: "command", command: "x", args: [] },
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
        intervalMs: 50,
        source: {
          kind: "command",
          command: process.execPath,
          args: ["-e", "console.log('hi')"],
        },
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
