import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

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

describe("S217 grant list command surface", () => {
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
});
