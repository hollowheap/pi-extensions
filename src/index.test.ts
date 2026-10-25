import { describe, expect, it, vi } from "vitest";
import suite from "./index.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

function createMockPi() {
  const unsubscribe = vi.fn();
  return {
    events: { on: vi.fn(() => unsubscribe), emit: vi.fn() },
    on: vi.fn(() => unsubscribe),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerMarkdownTransformer: vi.fn(),
    registerFlag: vi.fn(),
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    getAllTools: vi.fn(() => []),
    getActiveTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
    getThinkingLevel: vi.fn(() => "medium"),
  };
}

describe("suite entry", () => {
  it("registers every package factory", () => {
    const pi = createMockPi();
    suite(pi as never);

    const toolNames = pi.registerTool.mock.calls.map(
      ([tool]) => (tool as { name: string }).name,
    );
    expect(toolNames).toEqual(
      expect.arrayContaining(["fd", "rg", "code_intel"]),
    );

    const commandNames = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(commandNames).toEqual(
      expect.arrayContaining(["cd", "mode", "todos"]),
    );

    expect(pi.registerMessageRenderer).toHaveBeenCalled();
    expect(pi.registerMarkdownTransformer).toHaveBeenCalled();
    expect(pi.registerShortcut).toHaveBeenCalled();
    expect(pi.events.on).toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalled();
  });
});
