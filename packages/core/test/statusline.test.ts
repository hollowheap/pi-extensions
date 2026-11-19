import { describe, expect, it, vi } from "vitest";
import {
  type StatuslineContext,
  clearStatuslineEventValues,
  createScriptStatuslineProvider,
  createStatuslinePublisher,
  getStatuslineProvider,
  registerStatuslineProvider,
  setStatuslineEventValue,
  statuslineEventValues,
} from "../src/statusline.js";

function ctx(): StatuslineContext {
  return {
    cwd: "/work",
    homeDir: "/home/u",
    branch: "main",
    tokens: { input: 0, output: 0, cost: 0 },
    contextPercent: null,
    busy: false,
    now: new Date(2026, 0, 1),
  };
}

describe("statusline provider registry", () => {
  it("registers, overrides, and disposes providers by name", () => {
    const first = registerStatuslineProvider({
      name: "core-test-provider",
      render: () => "first",
    });
    expect(
      getStatuslineProvider("core-test-provider")?.render(
        { type: "core-test-provider" },
        ctx(),
      ),
    ).toBe("first");

    const replacement = registerStatuslineProvider({
      name: "core-test-provider",
      render: () => "second",
    });
    expect(
      getStatuslineProvider("core-test-provider")?.render(
        { type: "core-test-provider" },
        ctx(),
      ),
    ).toBe("second");

    replacement();
    expect(getStatuslineProvider("core-test-provider")).toBeUndefined();

    first();
    expect(getStatuslineProvider("core-test-provider")).toBeUndefined();
  });

  it("adapts legacy event values into providers and clears them", () => {
    clearStatuslineEventValues();
    setStatuslineEventValue("core-test-event", "VALUE");
    expect(statuslineEventValues().get("core-test-event")).toBe("VALUE");
    expect(
      getStatuslineProvider("core-test-event")?.render(
        { type: "core-test-event" },
        ctx(),
      ),
    ).toBe("VALUE");

    clearStatuslineEventValues();
    expect(getStatuslineProvider("core-test-event")).toBeUndefined();
  });
});

describe("script statusline provider", () => {
  it("executes the configured command and caches its first output line", async () => {
    const executor = vi.fn().mockResolvedValue({
      stdout: " main \nignored",
      code: 0,
    });
    const provider = createScriptStatuslineProvider(executor);
    const spec = {
      type: "script",
      command: "git branch",
      args: ["--show-current"],
      timeoutMs: 200,
    };

    expect(provider.render(spec, ctx())).toBe("");
    await provider.refresh?.(spec, ctx());
    expect(executor).toHaveBeenCalledWith("git", ["branch", "--show-current"], {
      cwd: "/work",
      timeoutMs: 200,
    });
    expect(provider.render(spec, ctx())).toBe("main");
  });

  it("clears cached output on failure and honors cwd overrides", async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "old", code: 0 })
      .mockResolvedValueOnce({ stdout: "failed", code: 1 });
    const provider = createScriptStatuslineProvider(executor);
    const spec = { type: "script", command: "task", cwd: "/other" };

    await provider.refresh?.(spec, ctx());
    expect(provider.render(spec, ctx())).toBe("old");
    expect(executor).toHaveBeenLastCalledWith("task", [], {
      cwd: "/other",
      timeoutMs: 1000,
    });

    await provider.refresh?.(spec, ctx());
    expect(provider.render(spec, ctx())).toBe("");
  });

  it("bounds interval and output length", async () => {
    const executor = vi
      .fn()
      .mockResolvedValue({ stdout: "x".repeat(5000), code: 0 });
    const provider = createScriptStatuslineProvider(executor);
    const spec = {
      type: "script",
      command: "long",
      intervalMs: -10,
      maxChars: 5,
    };

    expect(provider.intervalMs?.(spec)).toBe(250);
    await provider.refresh?.(spec, ctx());
    expect(provider.render(spec, ctx())).toBe("xxxxx");
  });
});

describe("createStatuslinePublisher", () => {
  it("emits statusline:values and responds to matching statusline:request events", () => {
    const listeners = new Map<string, Array<(data: unknown) => void>>();
    const emitted: Array<{ channel: string; data: unknown }> = [];
    const events = {
      on(channel: string, handler: (data: unknown) => void) {
        const list = listeners.get(channel) ?? [];
        list.push(handler);
        listeners.set(channel, list);
      },
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
        for (const handler of listeners.get(channel) ?? []) {
          handler(data);
        }
      },
    };

    let count = 2;
    const { publish, dispose } = createStatuslinePublisher(
      events,
      "tasks",
      () => (count > 0 ? `${count} running` : ""),
    );
    const values = () =>
      emitted.filter((entry) => entry.channel === "statusline:values");

    publish();
    expect(values()).toEqual([
      {
        channel: "statusline:values",
        data: { name: "tasks", text: "2 running" },
      },
    ]);

    emitted.length = 0;
    events.emit("statusline:request", { names: ["todos"] });
    expect(values()).toEqual([]);

    count = 1;
    events.emit("statusline:request", { names: ["todos", "tasks"] });
    expect(values()).toEqual([
      {
        channel: "statusline:values",
        data: { name: "tasks", text: "1 running" },
      },
    ]);

    emitted.length = 0;
    events.emit("statusline:request", undefined);
    expect(values()).toEqual([
      {
        channel: "statusline:values",
        data: { name: "tasks", text: "1 running" },
      },
    ]);

    emitted.length = 0;
    publish("");
    expect(values()).toEqual([
      { channel: "statusline:values", data: { name: "tasks", text: "" } },
    ]);

    dispose();
  });

  it("unsubscribes via returned function or off() on dispose", () => {
    const unsub = vi.fn();
    const eventsWithReturn = {
      on: vi.fn(() => unsub),
      off: vi.fn(),
      emit: vi.fn(),
    };
    const first = createStatuslinePublisher(
      eventsWithReturn,
      "tasks",
      () => "a",
    );
    first.dispose();
    first.dispose();
    expect(unsub).toHaveBeenCalledOnce();
    expect(eventsWithReturn.off).not.toHaveBeenCalled();

    const listeners = new Map<string, Array<(data: unknown) => void>>();
    const emitted: Array<{ channel: string; data: unknown }> = [];
    const eventsWithOff = {
      on(channel: string, handler: (data: unknown) => void) {
        const list = listeners.get(channel) ?? [];
        list.push(handler);
        listeners.set(channel, list);
      },
      off(channel: string, handler: (data: unknown) => void) {
        const list = listeners.get(channel) ?? [];
        listeners.set(
          channel,
          list.filter((entry) => entry !== handler),
        );
      },
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
        for (const handler of listeners.get(channel) ?? []) {
          handler(data);
        }
      },
    };
    const second = createStatuslinePublisher(eventsWithOff, "tasks", () => "b");
    second.dispose();
    eventsWithOff.emit("statusline:request", undefined);
    expect(emitted).toEqual([
      { channel: "statusline:request", data: undefined },
    ]);
  });

  it("handles undefined emitter safely", () => {
    const { publish, dispose } = createStatuslinePublisher(
      undefined,
      "tasks",
      () => "ok",
    );
    expect(() => publish()).not.toThrow();
    expect(() => dispose()).not.toThrow();
  });
});
