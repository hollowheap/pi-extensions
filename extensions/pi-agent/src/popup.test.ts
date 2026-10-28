import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import { showAgentSwitchPopup } from "./popup.js";

const sampleAgent: AgentConfig = {
  name: "scout",
  description: "Codebase scout",
  mode: "plan",
  model: "opencode-go/beam-free",
  effort: "low",
  tools: ["read", "grep"],
  skills: ["author-pr"],
  systemPrompt: "Instructions",
  source: "user",
  filePath: "/path/scout.md",
};

describe("showAgentSwitchPopup", () => {
  it("renders overlay modal in TUI mode via ctx.ui.custom", async () => {
    type FactoryFn = (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: () => void,
    ) => {
      render: (width: number) => string[];
      handleInput: (data: string) => void;
    };
    let capturedFactory: FactoryFn | undefined;
    const custom = vi.fn((factory: FactoryFn) => {
      capturedFactory = factory;
      return Promise.resolve();
    });

    const ctx = {
      mode: "tui",
      ui: { custom },
    } as unknown as ExtensionContext;

    await showAgentSwitchPopup(sampleAgent, ctx, {
      sessionName: "[scout] test",
      forked: true,
    });

    expect(custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: true,
    });
    expect(capturedFactory).toBeDefined();
    if (!capturedFactory) throw new Error("capturedFactory is undefined");

    const done = vi.fn();
    const component = capturedFactory(
      { requestRender: vi.fn() },
      { fg: (_color: string, text: string) => text },
      {},
      done,
    );

    const lines = component.render(80);
    expect(lines[0]?.startsWith("╭")).toBe(true);
    expect(lines[0]?.endsWith("╮")).toBe(true);
    expect(lines[lines.length - 1]?.startsWith("╰")).toBe(true);
    expect(lines[lines.length - 1]?.endsWith("╯")).toBe(true);
    expect(
      lines.some((l: string) => l.includes("Agent Activated: scout")),
    ).toBe(true);
    expect(lines.some((l: string) => l.includes("Mode:     plan"))).toBe(true);
    expect(
      lines.some((l: string) => l.includes("Model:    opencode-go/beam-free")),
    ).toBe(true);
    expect(lines.some((l: string) => l.includes("Tools:    read, grep"))).toBe(
      true,
    );
    expect(lines.some((l: string) => l.includes("Skills:   author-pr"))).toBe(
      true,
    );
    expect(
      lines.some((l: string) => l.includes("Branch:   [scout] test (forked)")),
    ).toBe(true);

    // Test input dismiss
    component.handleInput("\r");
    expect(done).toHaveBeenCalled();
  });

  it("falls back to confirm in dialog mode", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const ctx = {
      mode: "rpc",
      ui: { confirm },
    } as unknown as ExtensionContext;

    await showAgentSwitchPopup(sampleAgent, ctx, {
      sessionName: "[scout] test",
      forked: true,
    });

    expect(confirm).toHaveBeenCalledWith(
      "Agent: scout",
      expect.stringContaining("Mode: plan"),
    );
  });

  it("falls back to notify in non-dialog mode", async () => {
    const notify = vi.fn();
    const ctx = {
      mode: "print",
      ui: { notify },
    } as unknown as ExtensionContext;

    await showAgentSwitchPopup(sampleAgent, ctx, {
      sessionName: "[scout] test",
      forked: true,
    });

    expect(notify).toHaveBeenCalledWith(
      'Switched to agent "scout" (forked session)',
      "info",
    );
  });
});
