import { setMode } from "@hollowheap/core/state";
import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import { showAgentPicker } from "./picker.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

const agents: AgentConfig[] = [
  {
    name: "scout",
    description: "Fast recon",
    model: "provider/scout",
    source: "user",
    filePath: "/tmp/scout.md",
  },
  {
    name: "engineer",
    description: "Software engineer",
    model: "provider/engineer",
    source: "project",
    filePath: "/tmp/engineer.md",
  },
];

function pickerContext() {
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (value: string | undefined) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<string | undefined>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, component: () => component };
}

describe("showAgentPicker", () => {
  it("fuzzy filters and returns the selected agent", async () => {
    const env = pickerContext();
    const result = showAgentPicker(env.ctx as never, agents);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const component = env.component();
    const initial = component?.render(60) ?? [];
    expect(initial[0]).toContain("Select an agent");
    expect(initial[0]?.startsWith("╭")).toBe(true);
    expect(initial.at(-1)?.startsWith("╰")).toBe(true);
    expect(initial.join("\n")).toContain("engineer");
    for (const key of "eng") component?.handleInput(key);
    expect(component?.render(60).join("\n")).not.toContain("scout");
    component?.handleInput("\r");

    await expect(result).resolves.toBe("engineer");
  });

  it("returns undefined when cancelled", async () => {
    const env = pickerContext();
    const result = showAgentPicker(env.ctx as never, agents);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
  });

  it("previews the inherited mode for a mode-less agent", async () => {
    const env = pickerContext();
    const sessionManager = {};
    setMode(sessionManager, "plan", { persist: false });
    const ctx = { ...env.ctx, sessionManager };
    const result = showAgentPicker(ctx as never, [
      {
        name: "engineer",
        description: "Software engineer",
        source: "user",
        filePath: "/tmp/engineer.md",
      },
    ]);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    for (const key of "eng") env.component()?.handleInput(key);
    expect(env.component()?.render(60).join("\n")).toContain("mode: plan");

    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
  });
});
