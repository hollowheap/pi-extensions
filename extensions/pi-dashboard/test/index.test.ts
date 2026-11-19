import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setCwd } from "@hollowheap/core/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/exec.js";
import extension, { createDashboard } from "../src/index.js";
import { splitOutput } from "../src/render.js";
import { loadRecentSessions } from "../src/sessions.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

vi.mock("../src/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec.js")>();
  return { ...actual, runCommand: vi.fn(actual.runCommand) };
});

vi.mock("../src/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/sessions.js")>();
  return { ...actual, loadRecentSessions: vi.fn(actual.loadRecentSessions) };
});

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerCommand: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    cwd: tmpdir(),
    model: { id: "claude-sonnet-4-5" },
    thinkingLevel: "off",
    sessionManager: {},
    switchSession: vi.fn(async () => ({ cancelled: false })),
    ui: { setHeader: vi.fn(), notify: vi.fn(), custom: vi.fn() },
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
      if (line.length > 0) expect(visibleWidth(line)).toBe(60);
    }
    for (const line of component.render(40)) {
      if (line.length > 0) expect(visibleWidth(line)).toBe(40);
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

  it("auto-hides the startup header on agent_start and re-shows on empty session_tree", () => {
    const pi = createMockPi();
    extension(pi as never);
    let branch: Array<Record<string, unknown>> = [];
    const ctx = createMockCtx({
      sessionManager: {
        getBranch: () => branch,
      },
    });
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    const comp = installHeader(pi, ctx);
    expect(comp.render(60).length).toBeGreaterThan(0);

    handlers.agent_start(undefined as never, ctx as never);
    const hiddenFactory = ctx.ui.setHeader.mock.calls.at(-1)?.[0];
    expect(hiddenFactory({ requestRender: vi.fn() }, {}).render(60)).toEqual(
      [],
    );

    branch = [];
    handlers.session_tree(undefined as never, ctx as never);
    const reshownFactory = ctx.ui.setHeader.mock.calls.at(-1)?.[0];
    expect(
      reshownFactory({ requestRender: vi.fn() }, {}).render(60).length,
    ).toBeGreaterThan(0);
  });

  it("opens empty on a resumed branch with messages when autoHide is true", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx({
      sessionManager: {
        getBranch: () => [{ type: "message", message: { role: "user" } }],
      },
    });
    const comp = installHeader(pi, ctx);
    expect(comp.render(60)).toEqual([]);
  });

  it("does not send a dashboard built-in command to the model", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const registered = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const ctx = createMockCtx({
      ui: {
        setHeader: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn(async () => ({ type: "command", command: "/thinking" })),
      },
    });
    await registered.handler("", ctx);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("passes configured sessions scope and maxItems into the overlay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dash-scope-"));
    writeFileSync(
      join(dir, "dashboard.json"),
      JSON.stringify({
        sections: [{ type: "sessions", scope: "all", maxItems: 12, gap: 1 }],
      }),
    );
    state.agentDir = dir;
    vi.mocked(loadRecentSessions).mockClear();
    const pi = createMockPi();
    extension(pi as never);
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    handlers.session_start(undefined as never, createMockCtx() as never);

    const registered = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const commandCtx = createMockCtx({
      ui: {
        setHeader: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn(async () => ({ type: "close" })),
      },
    });
    await registered.handler("", commandCtx);

    expect(loadRecentSessions).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "all", limit: 12 }),
    );
  });

  it("starts the header with a single terminal refresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dash-refresh-"));
    writeFileSync(
      join(dir, "dashboard.json"),
      JSON.stringify({
        width: 60,
        sections: [
          {
            type: "terminal",
            command: "echo hi",
            args: [],
            intervalMs: 60000,
            gap: 0,
          },
        ],
      }),
    );
    state.agentDir = dir;
    vi.mocked(runCommand).mockClear();
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    installHeader(pi, ctx);
    await vi.waitFor(() =>
      expect(vi.mocked(runCommand).mock.calls.length).toBeGreaterThan(0),
    );
    await Promise.resolve();
    expect(
      vi.mocked(runCommand).mock.calls.filter((call) => call[0] === "echo hi"),
    ).toHaveLength(1);
  });

  it("supports /dashboard settings with argument completions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dash-cfg-"));
    state.agentDir = dir;
    const pi = createMockPi();
    extension(pi as never);
    const registered = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string }> | null;
    };

    expect(
      (registered.getArgumentCompletions?.("") ?? []).map((item) => item.value),
    ).toEqual(["settings"]);
    expect(
      (registered.getArgumentCompletions?.("set") ?? []).map(
        (item) => item.value,
      ),
    ).toEqual(["settings"]);
    expect(registered.getArgumentCompletions?.("con")).toEqual([]);
    expect(registered.getArgumentCompletions?.("settings extra")).toBeNull();

    let component:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => {
          handleInput(data: string): void;
          render(width: number): string[];
        },
      ) =>
        new Promise<void>((resolve) => {
          component = factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, s: string) => s, bold: (s: string) => s },
            {},
            resolve,
          );
        }),
    );
    const ctx = createMockCtx({
      hasUI: true,
      ui: { setHeader: vi.fn(), notify: vi.fn(), custom },
    });

    const pending = registered.handler("settings", ctx);
    await vi.waitFor(() => expect(component).toBeDefined());
    expect(component?.render(80).join("\n")).toContain("Dashboard settings");
    component?.handleInput("\x1b");
    await pending;
    expect(custom).toHaveBeenCalledTimes(1);
  });

  it("notifies with error when saving dashboard settings fails with permission or config errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dash-err-"));
    const cfgPath = join(dir, "dashboard.json");
    writeFileSync(cfgPath, "{invalid-json");
    state.agentDir = dir;
    const pi = createMockPi();
    extension(pi as never);
    const registered = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };

    let component:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    const notify = vi.fn();
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => {
          handleInput(data: string): void;
          render(width: number): string[];
        },
      ) =>
        new Promise<void>((resolve) => {
          component = factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, s: string) => s, bold: (s: string) => s },
            {},
            resolve,
          );
        }),
    );
    const ctx = createMockCtx({
      hasUI: true,
      ui: { setHeader: vi.fn(), notify, custom },
    });

    const pending = registered.handler("settings", ctx);
    await vi.waitFor(() => expect(component).toBeDefined());
    component?.handleInput("\r");
    component?.handleInput("\x1b");
    await pending;
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("failed to save settings"),
      "error",
    );

    if (process.getuid?.() !== 0) {
      const permDir = mkdtempSync(join(tmpdir(), "pi-dash-perm-"));
      const permPath = join(permDir, "dashboard.json");
      writeFileSync(permPath, "{}");
      chmodSync(permPath, 0o000);
      state.agentDir = permDir;
      try {
        const permNotify = vi.fn();
        const permCtx = createMockCtx({
          hasUI: true,
          ui: {
            setHeader: vi.fn(),
            notify: permNotify,
            custom: vi.fn(async () => undefined),
          },
        });
        await registered.handler("settings", permCtx);
        expect(permNotify).toHaveBeenCalledWith(
          expect.stringContaining("OS permission denied"),
          "error",
        );
      } finally {
        chmodSync(permPath, 0o600);
      }
    }
  });

  it("re-installs dashboard on dashboard:config-changed and cleans up on shutdown", () => {
    const unsub = vi.fn();
    const listeners = new Map<string, (data: unknown) => void>();
    const pi = {
      ...createMockPi(),
      events: {
        on: vi.fn((channel: string, handler: (data: unknown) => void) => {
          listeners.set(channel, handler);
          return unsub;
        }),
        emit: vi.fn(),
      },
    };
    extension(pi as never);
    const ctx = createMockCtx();
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    handlers.session_start(undefined as never, ctx as never);
    expect(ctx.ui.setHeader).toHaveBeenCalledTimes(1);

    const onConfigChanged = listeners.get("dashboard:config-changed");
    expect(onConfigChanged).toBeDefined();
    onConfigChanged?.({
      width: 72,
      autoHide: false,
      sections: [{ type: "header", ascii: ["CUSTOM"], gap: 0 }],
    });

    expect(ctx.ui.setHeader).toHaveBeenCalledTimes(2);
    const factory = ctx.ui.setHeader.mock.calls[1][0];
    const header = factory({ requestRender: vi.fn() }, {});
    expect(header.render(40).join("\n")).toContain("CUSTOM");
    header.dispose();

    handlers.session_shutdown(undefined as never, ctx as never);
    expect(unsub).toHaveBeenCalledTimes(1);
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

  it("renders state, sessions, and actions sections", async () => {
    const owner = {};
    const controller = createDashboard(
      {
        width: 72,
        sections: [
          { type: "state", gap: 1 },
          { type: "sessions", maxItems: 3, scope: "cwd", gap: 1 },
          { type: "actions", gap: 0 },
        ],
      },
      {
        run: vi.fn(async () => ""),
        notify: vi.fn(),
        snapshotOwner: owner,
        getStateInput: () => ({
          cwd: "/repo/demo",
          model: "claude-sonnet-4-5",
        }),
        loadSessions: async () => [
          {
            id: "sess-1",
            path: "/tmp/s1.jsonl",
            cwd: "/repo/demo",
            created: new Date("2026-01-01T00:00:00Z"),
            modified: new Date("2026-01-01T01:00:00Z"),
            messageCount: 7,
            firstMessage: "refactor dashboard",
            summary: { todosOpen: 2, totalCost: 0.42 },
          },
        ],
      },
    );
    await controller.refresh();
    const joined = controller.lines().join("\n");
    expect(joined).toContain("Session State");
    expect(joined).toContain("demo");
    expect(joined).toContain("Recent Sessions");
    expect(joined).toContain("refactor dashboard");
    expect(joined).toContain("Quick Actions");
    expect(joined).toContain("/todos");
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

  it("centers command output when align is center", async () => {
    const deps = fakeDeps("hi\n");
    const controller = createDashboard(
      {
        width: 6,
        sections: [
          {
            type: "terminal",
            command: "x",
            args: [],
            intervalMs: 50,
            align: "center",
            gap: 0,
          },
        ],
      },
      deps,
    );
    await controller.refresh();
    expect(controller.lines()).toEqual(["  hi  "]);
    controller.stop();
  });

  it("sanitizes command output containing OSC, DCS, APC, or \\r before fitLines", async () => {
    const dirtyOutput =
      "hello\x1b]0;title\x07world\r\n\x1b_apc\x1b\\line2\x1bPraw\x1b\\end";
    const deps = fakeDeps(dirtyOutput);
    const controller = createDashboard(
      {
        width: 20,
        sections: [
          {
            type: "terminal",
            command: "test-cmd",
            args: [],
            intervalMs: 50,
            gap: 0,
          },
        ],
      },
      deps,
    );
    await controller.refresh();
    const lines = controller.lines();
    expect(lines).toEqual(["helloworld          ", "line2end            "]);
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

  it("does not restart polling after stop", async () => {
    vi.useFakeTimers();
    try {
      const deps = fakeDeps("x\n");
      const controller = createDashboard(
        {
          width: 5,
          sections: [
            {
              type: "terminal",
              command: "x",
              args: [],
              intervalMs: 50,
              gap: 0,
            },
          ],
        },
        deps,
      );
      controller.start(() => {});
      controller.stop();
      controller.start(() => {});
      await vi.advanceTimersByTimeAsync(100);
      expect(deps.run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
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

  it("preserves 16-color, 256-color, and TrueColor SGR sequences in terminal sections while stripping control sequences", async () => {
    const rawOutput =
      "\x1b[31m16-color\x1b[0m " +
      "\x1b[38;5;208m256-color\x1b[0m " +
      "\x1b[38;2;255;100;0mTrueColor\x1b[0m\n" +
      "\x1b]52;c;ZXZpbA==\x07" +
      "\x1b]2;title\x07" +
      "\x1b[2J\x1b[H\x1b[?25l" +
      "\x00\x07\x08line2";

    const controller = createDashboard(
      {
        width: 60,
        sections: [
          {
            type: "terminal",
            command: "echo",
            args: [],
            intervalMs: 1000,
            gap: 0,
          },
        ],
      },
      {
        run: async () => rawOutput,
        notify: () => {},
      },
    );

    await controller.refresh();
    const lines = controller.lines();
    expect(lines[0]).toContain("\x1b[31m16-color\x1b[0m");
    expect(lines[0]).toContain("\x1b[38;5;208m256-color\x1b[0m");
    expect(lines[0]).toContain("\x1b[38;2;255;100;0mTrueColor\x1b[0m");
    expect(lines[0]).not.toContain("\x1b]52");
    expect(lines[0]).not.toContain("\x1b]2");
    expect(lines[0]).not.toContain("\x1b[2J");
    expect(lines[1]).toContain("line2");
    expect(lines[1]).not.toContain("\x07");

    expect(splitOutput(rawOutput)).toEqual([
      "\x1b[31m16-color\x1b[0m \x1b[38;5;208m256-color\x1b[0m \x1b[38;2;255;100;0mTrueColor\x1b[0m",
      "line2",
    ]);
  });
});
