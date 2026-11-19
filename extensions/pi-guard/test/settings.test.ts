import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { describe, expect, it, vi } from "vitest";
import { show } from "../src/settings-ui.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

function settingsContext() {
  let component: { dispose?(): void } | undefined;
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: {
      notify: vi.fn(),
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void,
          ) => { dispose?(): void },
        ) =>
          new Promise<void>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, component: () => component };
}

describe("show", () => {
  it("settles and releases the prompt lock when disposed without input", async () => {
    const env = settingsContext();
    const result = show({
      ctx: env.ctx as never,
      agentDir: "/nonexistent-pi-agent-dir-for-tests",
      cwd: "/tmp",
      activeGrantCount: () => 0,
      onClearGrants: () => 0,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    expect(env.component()?.dispose).toBeTypeOf("function");
    env.component()?.dispose?.();
    await expect(result).resolves.toBeUndefined();
    await expect(withPromptLock(async () => "next")).resolves.toBe("next");
  });
});
