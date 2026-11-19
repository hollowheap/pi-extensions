import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
  };
}

type CommandDef = {
  handler?: (args: string, ctx: unknown) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => Array<{ value: string }> | null;
};

function command(
  pi: ReturnType<typeof createMockPi>,
  name: string,
): CommandDef {
  const call = pi.registerCommand.mock.calls.find(([n]) => n === name);
  return (call?.[1] as CommandDef | undefined) ?? {};
}

function createCtx() {
  return {
    cwd: process.cwd(),
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
  };
}

describe("grant list command surface", () => {
  it("does not register a separate grants command", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(names).toContain("grant");
    expect(names).not.toContain("grants");
  });

  it("lists active grants with expiry through /grant list", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createCtx();
    const grant = command(pi, "grant");

    await grant.handler?.("src/x.ts 5m", ctx);
    ctx.ui.notify.mockClear();

    await grant.handler?.("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("src/x.ts"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("expires in"),
      "info",
    );
  });

  it("offers list as a grant subcommand completion", () => {
    const pi = createMockPi();
    extension(pi as never);

    const completions = command(pi, "grant").getArgumentCompletions?.("li");
    expect((completions ?? []).map((item) => item.value)).toContain("list");
  });

  it("listing with no grants reports an empty result", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createCtx();

    await command(pi, "grant").handler?.("list", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("No active grants", "info");
  });

  it("an invalid duration is refused and stores no grant", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createCtx();
    const grant = command(pi, "grant");

    await grant.handler?.("src/y.ts tomorrow", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Invalid duration. Use e.g. 5m, 1h, 30s",
      "error",
    );

    ctx.ui.notify.mockClear();
    await grant.handler?.("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No active grants", "info");
  });

  it("every active grant is listed and durations complete", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createCtx();
    const grant = command(pi, "grant");

    await grant.handler?.("src/a.ts 5m", ctx);
    await grant.handler?.("src/b.ts 1h", ctx);
    ctx.ui.notify.mockClear();

    await grant.handler?.("list", ctx);
    const text = ctx.ui.notify.mock.calls[0]?.[0] as string;
    expect(text).toContain("src/a.ts");
    expect(text).toContain("src/b.ts");
    expect(text.match(/expires in/g)).toHaveLength(2);

    const durations = (grant.getArgumentCompletions?.("src/a.ts 1") ?? []).map(
      (item) => item.value,
    );
    expect(durations).toContain("1h");
  });
});
