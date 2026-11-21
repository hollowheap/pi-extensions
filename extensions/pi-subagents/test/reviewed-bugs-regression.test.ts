import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubagentsExtension } from "../src/index.js";
import {
  readSubagentLog,
  reconcileSubagent,
  startSubagent,
  waitSubagent,
} from "../src/runner.js";
import { SubagentStore } from "../src/state.js";
import { createSubagentTool } from "../src/tool.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi-subagents reviewed bug regressions", () => {
  it("flushes buffered child stdout/stderr to the log before runner-shim exits", async () => {
    const dir = makeTempDir("pi-subagents-log-flush-");
    const state = await startSubagent({
      agentDir: dir,
      agent: "worker",
      task: "burst output",
      depth: 0,
      command: process.execPath,
      args: [
        "-e",
        'setTimeout(() => { process.stdout.write("START\\n" + "A".repeat(32768) + "\\nEND-MARKER\\n"); process.stderr.write("ERR-MARKER\\n"); process.exit(0); }, 100);',
      ],
      cwd: dir,
      sandbox: false,
    });

    const final = await waitSubagent(dir, state.id, 5_000);
    expect(final?.status).toBe("completed");
    const log = readSubagentLog(dir, state.id);
    expect(log).toContain("END-MARKER");
    expect(log).toContain("ERR-MARKER");
  });

  it("does not let a stale reconcile overwrite a concurrently resumed attempt", async () => {
    const dir = makeTempDir("pi-subagents-reconcile-");
    const store = new SubagentStore(dir);
    const id = "subagent-reconcile-race";
    const staleState = {
      id,
      agent: "worker",
      task: "task",
      status: "running" as const,
      depth: 0,
      attempt: 1,
      startedAt: 1_000,
      pid: 999_999_999,
      runnerPid: 999_999_998,
    };
    store.write(staleState);

    store.write({
      ...staleState,
      attempt: 2,
      startedAt: 2_000,
      pid: process.pid,
      runnerPid: process.pid,
    });

    await reconcileSubagent(dir, staleState);
    const current = store.read(id);
    expect(current?.status).toBe("running");
    expect(current?.attempt).toBe(2);
    expect(current?.startedAt).toBe(2_000);
  });

  it("guards post-await emitSubagentsState updates after session_shutdown", async () => {
    const dir = makeTempDir("pi-subagents-shutdown-");
    let resolveList!: (
      value: Awaited<ReturnType<SubagentStore["list"]>>,
    ) => void;
    const listSubagents = vi.fn(
      () =>
        new Promise<ReturnType<SubagentStore["list"]>>((resolve) => {
          resolveList = resolve;
        }),
    );

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const pi = {
      on: (event: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(event, fn);
      },
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: {
        on: vi.fn(() => () => {}),
        emit: (event: string, payload: unknown) => {
          emitted.push({ event, payload });
        },
      },
    } as unknown as ExtensionAPI;

    createSubagentsExtension({
      getAgentDir: () => dir,
      listSubagents,
    })(pi);

    const setWidget = vi.fn();
    const ctx = {
      hasUI: true,
      cwd: dir,
      ui: { setWidget, notify: vi.fn() },
    };

    handlers.get("session_start")?.({}, ctx);
    handlers.get("session_shutdown")?.({}, ctx);

    emitted.length = 0;
    setWidget.mockClear();

    resolveList([
      {
        id: "sub-1",
        agent: "worker",
        task: "still running",
        status: "running",
        depth: 0,
        attempt: 1,
        startedAt: Date.now(),
        project: dir,
      },
    ]);
    await new Promise((r) => setTimeout(r, 20));

    expect(emitted.filter((e) => e.event === "subagents:state")).toHaveLength(
      0,
    );
    expect(setWidget).not.toHaveBeenCalled();
  });

  it("handles uppercase /subagent command actions via lowerAction", async () => {
    const dir = makeTempDir("pi-subagents-cmd-");
    let commandHandler:
      | ((args: string, ctx: unknown) => Promise<void>)
      | undefined;
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(
        (
          name: string,
          spec: { handler: (args: string, ctx: unknown) => Promise<void> },
        ) => {
          if (name === "subagent") commandHandler = spec.handler;
        },
      ),
      events: {
        on: vi.fn(() => () => {}),
        emit: vi.fn(),
      },
    } as unknown as ExtensionAPI;

    createSubagentsExtension({
      getAgentDir: () => dir,
      listSubagents: async () => [],
    })(pi);

    const notify = vi.fn();
    const ctx = {
      hasUI: true,
      cwd: dir,
      ui: { notify, setWidget: vi.fn() },
    };

    await commandHandler?.("PAUSE missing-id", ctx);
    expect(notify).toHaveBeenCalledWith("Unknown subagent missing-id", "error");

    notify.mockClear();
    await commandHandler?.("STEER missing-id hello", ctx);
    expect(notify).toHaveBeenCalledWith("Unknown subagent missing-id", "error");
  });

  it("sanitizes untrusted terminal sequences in renderCall and renderResult", () => {
    const tool = createSubagentTool({});
    const dirty = "\u001b[31mevil\u001b[0m\u001b]52;c;abc\u0007";

    const callComponent = tool.renderCall?.(
      {
        action: "start",
        agent: `agent-${dirty}`,
        task: `task-${dirty}`,
      },
      plainTheme,
      {} as never,
    );
    const callText = callComponent?.render(200).join("\n") ?? "";
    expect(callText).not.toContain("\u001b");

    const resultComponent = tool.renderResult?.(
      {
        content: [{ type: "text", text: "ok" }],
        details: {
          status: "completed",
          agent: `agent-${dirty}`,
          workspace: `/tmp/${dirty}`,
          log: `line1-${dirty}\nline2`,
        },
      },
      { expanded: true, isPartial: false },
      plainTheme,
      {} as never,
    );
    const resultText = resultComponent?.render(200).join("\n") ?? "";
    expect(resultText).not.toContain("\u001b");
    expect(resultText).toContain("line1-");
  });
});
